"""
AI 쇼츠 자동 생성 (PostgreSQL 완전 호환)
- status: 0=pending, 1=done, 9=failed
- 배경: default_bg.jpg 또는 assets/ 폴더만
- 인코딩: 1080x1920, 2.5Mbps 이상
"""
import logging
import subprocess
import asyncio
import shutil
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timedelta

import edge_tts
from gtts import gTTS
import sqlalchemy
from sqlalchemy import text
from PIL import Image, ImageDraw, ImageFont
import numpy as np

from moviepy.editor import (
    VideoClip, AudioFileClip, CompositeVideoClip, TextClip, 
    concatenate_audioclips
)
import moviepy.audio.fx.all as afx

from config import (
    DB_CONNECTION_STRING, OUTPUT_DIR, BASE_DIR,
    LOG_FORMAT, LOG_LEVEL, EDGE_TTS_VOICES, DEFAULT_VOICE
)
from persona_manager import persona_manager

logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)

VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
VIDEO_FPS = 24
BGM_VOLUME = 0.30
MIN_FILE_SIZE = 1024 * 1024  # 1MB

TEMP_DIR = BASE_DIR / "temp"
ASSETS_DIR = BASE_DIR / "assets"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)
ASSETS_DIR.mkdir(exist_ok=True)

DEFAULT_BG_PATH = ASSETS_DIR / "default_bg.jpg"

engine = sqlalchemy.create_engine(DB_CONNECTION_STRING, pool_pre_ping=True)


def ensure_default_background():
    """기본 배경 생성"""
    if DEFAULT_BG_PATH.exists():
        return
    
    try:
        gradient = np.zeros((VIDEO_HEIGHT, VIDEO_WIDTH, 3), dtype=np.uint8)
        top = (15, 30, 60)
        bot = (5, 10, 25)
        
        for y in range(VIDEO_HEIGHT):
            ratio = y / VIDEO_HEIGHT
            gradient[y, :] = (
                int(top[0] + (bot[0] - top[0]) * ratio),
                int(top[1] + (bot[1] - top[1]) * ratio),
                int(top[2] + (bot[2] - top[2]) * ratio),
            )
        
        img = Image.fromarray(gradient)
        img.save(DEFAULT_BG_PATH, quality=95)
        logger.info(f"✅ default_bg.jpg 생성: {DEFAULT_BG_PATH}")
    except Exception as e:
        logger.error(f"기본 배경 생성 실패: {e}")


def get_target_by_bno(bno: int) -> Optional[Dict[str, Any]]:
    """shorts_queue + ai_board JOIN 조회"""
    try:
        query = text("""
            SELECT 
                q.bno, b.title, b.content, q.video_type, 
                COALESCE(b.p_id, 'default') as p_id, q.status
            FROM shorts_queue q
            JOIN ai_board b ON q.bno = b.bno
            WHERE q.bno = :bno
            LIMIT 1
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"bno": bno})
            row = result.fetchone()
            
            if not row:
                return None
            
            return {
                "bno": row[0],
                "title": row[1],
                "content": row[2],
                "video_type": row[3],
                "p_id": row[4],
                "status": row[5]
            }
    except Exception as e:
        logger.error(f"DB 조회 실패 (bno={bno}): {e}")
        return None


def update_queue_status(bno: int, status: int, video_path: str = None, thumbnail_path: str = None, error_msg: str = None):
    """shorts_queue 상태 업데이트 (status: 0/1/9)"""
    try:
        if video_path:
            query = text("""
                UPDATE shorts_queue
                SET status = :status,
                    video_path = :video_path,
                    thumbnail_path = :thumbnail_path
                WHERE bno = :bno
            """)
            with engine.connect() as conn:
                conn.execute(query, {
                    "status": status,
                    "video_path": video_path,
                    "thumbnail_path": thumbnail_path or "",
                    "bno": bno
                })
                conn.commit()
        elif error_msg:
            query = text("""
                UPDATE shorts_queue
                SET status = :status,
                    error_msg = :error_msg
                WHERE bno = :bno
            """)
            with engine.connect() as conn:
                conn.execute(query, {
                    "status": status,
                    "error_msg": error_msg,
                    "bno": bno
                })
                conn.commit()
        else:
            query = text("""
                UPDATE shorts_queue
                SET status = :status
                WHERE bno = :bno
            """)
            with engine.connect() as conn:
                conn.execute(query, {"status": status, "bno": bno})
                conn.commit()
        
        logger.info(f"상태 업데이트: bno={bno}, status={status}")
    except Exception as e:
        logger.error(f"상태 업데이트 실패: {e}")


def insert_upload_schedule(bno: int) -> bool:
    """upload_schedule 등록 (PostgreSQL)"""
    try:
        check_query = text("SELECT COUNT(*) FROM upload_schedule WHERE bno = :bno")
        
        with engine.connect() as conn:
            result = conn.execute(check_query, {"bno": bno})
            count = result.scalar()
            
            if count > 0:
                logger.warning(f"이미 등록됨: bno={bno}")
                return True
            
            scheduled_time = datetime.now() + timedelta(hours=1)
            
            insert_query = text("""
                INSERT INTO upload_schedule (bno, scheduled_time, status)
                VALUES (:bno, :scheduled_time, 'SCHEDULED')
            """)
            
            conn.execute(insert_query, {
                "bno": bno,
                "scheduled_time": scheduled_time
            })
            conn.commit()
            
            logger.info(f"✅ 업로드 스케줄 등록: bno={bno}")
            return True
            
    except Exception as e:
        logger.error(f"스케줄 등록 실패: {e}")
        return False


async def generate_audio_async(text: str, voice: str, speed: str, output_path: Path) -> bool:
    """edge-tts 음성 생성"""
    try:
        rate_value = speed.replace("+", "").replace("%", "")
        rate_str = f"+{rate_value}%"
        
        communicate = edge_tts.Communicate(text, voice, rate=rate_str)
        await communicate.save(str(output_path))
        
        return output_path.exists()
    except Exception as e:
        logger.warning(f"edge-tts 실패: {e}")
        return False


def generate_audio_with_gtts(text: str, output_path: Path) -> bool:
    """gTTS fallback"""
    try:
        tts = gTTS(text=text, lang='ko', slow=False)
        tts.save(str(output_path))
        return output_path.exists()
    except Exception as e:
        logger.error(f"gTTS 실패: {e}")
        return False


def apply_speed_with_ffmpeg(input_path: Path, output_path: Path, speed: float = 1.35) -> bool:
    """ffmpeg atempo 속도 조정"""
    try:
        cmd = [
            "ffmpeg", "-y", "-i", str(input_path),
            "-af", f"atempo={speed},apad=pad_dur=0.2",
            str(output_path)
        ]
        
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        
        if result.returncode == 0 and output_path.exists():
            return True
        
        shutil.copy(input_path, output_path)
        return True
        
    except Exception as e:
        logger.warning(f"ffmpeg 실행 실패: {e}")
        shutil.copy(input_path, output_path)
        return True


def generate_audio_sync(text: str, voice: str, speed: str, output_path: Path) -> bool:
    """TTS 생성 + 속도 조정"""
    temp_path = output_path.parent / f"temp_{output_path.name}"
    
    success = asyncio.run(generate_audio_async(text, voice, speed, temp_path))
    
    if not success:
        logger.warning("edge-tts 실패 → gTTS fallback")
        success = generate_audio_with_gtts(text, temp_path)
    
    if not success:
        return False
    
    apply_speed_with_ffmpeg(temp_path, output_path, speed=1.35)
    
    if temp_path.exists():
        temp_path.unlink()
    
    return output_path.exists()


def split_text_into_parts(text: str, max_length: int = 80) -> List[str]:
    """텍스트 분할"""
    sentences = text.replace("! ", "!|").replace(". ", ".|").replace("? ", "?|").split("|")
    
    parts = []
    current = ""
    
    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
        
        if len(current) + len(sent) <= max_length:
            current += sent + " "
        else:
            if current:
                parts.append(current.strip())
            current = sent + " "
    
    if current:
        parts.append(current.strip())
    
    return parts if parts else [text[:max_length]]


def get_background_images(bno: int, count: int = 3) -> List[Path]:
    """배경 이미지 (assets/ 또는 default_bg.jpg)"""
    images = []
    
    # assets/ 폴더에서 이미지 검색
    for ext in ['*.jpg', '*.jpeg', '*.png']:
        for img_path in ASSETS_DIR.glob(ext):
            if img_path.name != "default_bg.jpg" and len(images) < count:
                images.append(img_path)
    
    # 부족하면 default_bg.jpg로 채움
    ensure_default_background()
    while len(images) < count:
        images.append(DEFAULT_BG_PATH)
    
    logger.info(f"배경 이미지: {len(images)}개 (assets 우선)")
    return images[:count]


def create_ken_burns_clip(img_path: Path, duration: float, direction: str = "zoom_in") -> VideoClip:
    """Ken Burns 효과"""
    img = Image.open(str(img_path)).convert("RGB")
    
    # 9:16 비율로 crop
    w, h = img.size
    target_ratio = VIDEO_WIDTH / VIDEO_HEIGHT
    current_ratio = w / h
    
    if current_ratio > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    
    img = img.resize((int(VIDEO_WIDTH * 1.1), int(VIDEO_HEIGHT * 1.1)), Image.LANCZOS)
    
    base_frame = np.array(img)
    bh, bw = base_frame.shape[:2]
    tw, th = VIDEO_WIDTH, VIDEO_HEIGHT
    max_dx = bw - tw
    max_dy = bh - th
    
    def make_frame(t):
        progress = min(t / duration, 1.0) if duration > 0 else 0.0
        
        if direction == "zoom_in":
            crop_w = int(bw - max_dx * progress)
            crop_h = int(bh - max_dy * progress)
            x1 = (bw - crop_w) // 2
            y1 = (bh - crop_h) // 2
        else:
            crop_w = int(tw + max_dx * progress)
            crop_h = int(th + max_dy * progress)
            x1 = (bw - crop_w) // 2
            y1 = (bh - crop_h) // 2
        
        x1 = max(0, min(x1, bw - tw))
        y1 = max(0, min(y1, bh - th))
        
        cropped = base_frame[y1:y1 + th, x1:x1 + tw]
        
        if cropped.shape[:2] != (th, tw):
            pil_crop = Image.fromarray(cropped)
            pil_crop = pil_crop.resize((tw, th), Image.LANCZOS)
            return np.array(pil_crop)
        
        return cropped
    
    clip = VideoClip(make_frame, duration=duration)
    clip.fps = VIDEO_FPS
    clip.size = (tw, th)
    return clip


def create_thumbnail(title: str, video_type: str, bno: int) -> str:
    """썸네일 생성 (텍스트 중심)"""
    try:
        width, height = 1080, 1920
        
        # default_bg 기반
        ensure_default_background()
        img = Image.open(DEFAULT_BG_PATH).convert("RGB")
        
        overlay = Image.new('RGBA', (width, height), (0, 0, 0, 160))
        img = img.convert('RGBA')
        img = Image.alpha_composite(img, overlay).convert('RGB')
        
        draw = ImageDraw.Draw(img)
        
        try:
            font_title = ImageFont.truetype("/Users/changwan/Library/Fonts/Pretendard-Bold.otf", 90)
            font_badge = ImageFont.truetype("/Users/changwan/Library/Fonts/Pretendard-Bold.otf", 50)
        except:
            font_title = ImageFont.load_default()
            font_badge = ImageFont.load_default()
        
        badge_text = "🔥 긴급" if video_type == "AGRO" else "💡 심층"
        bbox = draw.textbbox((0, 0), badge_text, font=font_badge)
        badge_w = bbox[2] - bbox[0]
        badge_h = bbox[3] - bbox[1]
        badge_x, badge_y = 50, 100
        
        draw.rounded_rectangle(
            [badge_x - 20, badge_y - 10, badge_x + badge_w + 20, badge_y + badge_h + 10],
            radius=15,
            fill=(255, 215, 0, 220)
        )
        draw.text((badge_x, badge_y), badge_text, font=font_badge, fill=(20, 20, 30))
        
        hook = " ".join(title.split()[:8])
        if len(hook) > 50:
            hook = hook[:47] + "..."
        
        words = hook.split()
        lines = []
        current_line = ""
        
        for word in words:
            test_line = current_line + word + " "
            bbox = font_title.getbbox(test_line)
            width_test = bbox[2] - bbox[0]
            
            if width_test <= width - 120:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line.strip())
                current_line = word + " "
        
        if current_line:
            lines.append(current_line.strip())
        
        wrapped = "\n".join(lines)
        
        bbox = draw.multiline_textbbox((0, 0), wrapped, font=font_title, align='center')
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        
        text_x = (width - text_w) // 2
        text_y = (height - text_h) // 2
        
        padding = 40
        draw.rounded_rectangle(
            [text_x - padding, text_y - padding, text_x + text_w + padding, text_y + text_h + padding],
            radius=20,
            fill=(0, 0, 0, 200)
        )
        
        draw.multiline_text(
            (text_x + 4, text_y + 4),
            wrapped,
            font=font_title,
            fill=(10, 10, 20),
            align='center'
        )
        
        main_color = (255, 255, 255) if video_type == "INFO" else (255, 215, 0)
        draw.multiline_text(
            (text_x, text_y),
            wrapped,
            font=font_title,
            fill=main_color,
            align='center'
        )
        
        output_path = OUTPUT_DIR / f"thumb_{video_type}_{bno}.jpg"
        img.save(output_path, quality=95)
        
        logger.info(f"✅ 썸네일 생성: {output_path}")
        return str(output_path)
        
    except Exception as e:
        logger.error(f"썸네일 생성 실패: {e}")
        return ""


def render_video_with_persona(
    title: str,
    content: str,
    video_type: str,
    p_id: str,
    bno: int
) -> Tuple[Optional[str], Optional[str]]:
    """영상 렌더링 (품질 보장)"""
    try:
        logger.info(f"🎬 영상 생성 시작: bno={bno}")
        
        tts_config = persona_manager.get_tts_config(p_id)
        voice = tts_config["voice"]
        speed = tts_config["speed"]
        
        logger.info(f"🎙️ Persona: {tts_config['persona_name']}, Voice: {voice}")
        
        parts = split_text_into_parts(content, max_length=80)
        logger.info(f"📝 텍스트 분할: {len(parts)}개")
        
        audio_files = []
        for idx, part in enumerate(parts):
            audio_path = TEMP_DIR / f"tts_{bno}_{idx}.mp3"
            success = generate_audio_sync(part, voice, speed, audio_path)
            
            if success:
                audio_files.append(audio_path)
            else:
                logger.warning(f"TTS 실패: part {idx}")
        
        if not audio_files:
            logger.error("TTS 생성 실패")
            return None, None
        
        bg_images = get_background_images(bno, count=len(parts))
        
        body_clips = []
        body_time = 0.0
        
        for idx, audio_path in enumerate(audio_files):
            audio = AudioFileClip(str(audio_path))
            part_dur = audio.duration
            
            img_idx = idx % len(bg_images)
            kb_dir = "zoom_in" if idx % 2 == 0 else "zoom_out"
            
            kb_clip = create_ken_burns_clip(
                bg_images[img_idx], part_dur, direction=kb_dir
            ).set_start(body_time)
            
            body_clips.append(kb_clip)
            
            text = parts[idx]
            y_pos = 800 if idx % 2 == 0 else 900
            
            shadow = TextClip(
                txt=text,
                fontsize=70,
                color='#0a0a14',
                font='/Users/changwan/Library/Fonts/D2Coding-Ver1.3.2-20180524-ligature.ttc',
                method='caption',
                size=(900, None)
            ).set_duration(part_dur).set_position(('center', y_pos + 3)).set_start(body_time)
            
            body_clips.append(shadow)
            
            main_text = TextClip(
                txt=text,
                fontsize=70,
                color='white',
                font='/Users/changwan/Library/Fonts/D2Coding-Ver1.3.2-20180524-ligature.ttc',
                stroke_color='#1a1a2e',
                stroke_width=3,
                method='caption',
                size=(900, None)
            ).set_duration(part_dur).set_position(('center', y_pos)).set_start(body_time)
            
            body_clips.append(main_text)
            
            body_time += part_dur
        
        final_video = CompositeVideoClip(body_clips, size=(VIDEO_WIDTH, VIDEO_HEIGHT))
        
        full_audio = concatenate_audioclips([AudioFileClip(str(a)) for a in audio_files])
        
        bgm_path = ASSETS_DIR / "bgm.mp3"
        if bgm_path.exists():
            try:
                from moviepy.audio.AudioClip import CompositeAudioClip
                bgm = AudioFileClip(str(bgm_path))
                bgm = bgm.subclip(0, min(bgm.duration, final_video.duration))
                bgm = bgm.fx(afx.volumex, BGM_VOLUME)
                final_audio = CompositeAudioClip([full_audio, bgm])
            except Exception as e:
                logger.warning(f"BGM 처리 실패: {e}")
        
        final_video = final_video.set_audio(final_audio)
        
        output_path = OUTPUT_DIR / f"shorts_{video_type}_{bno}.mp4"
        
        # 품질 보장: 1080x1920, 2.5Mbps
        final_video.write_videofile(
            str(output_path),
            fps=VIDEO_FPS,
            codec='libx264',
            bitrate='2500k',
            audio_codec='aac',
            preset='medium',
            threads=4,
            ffmpeg_params=['-pix_fmt', 'yuv420p']
        )
        
        thumbnail_path = create_thumbnail(title, video_type, bno)
        
        final_video.close()
        for audio_path in audio_files:
            audio_path.unlink(missing_ok=True)
        
        # 파일 크기 검증
        if output_path.exists() and output_path.stat().st_size < MIN_FILE_SIZE:
            logger.error(f"파일 크기 부족: {output_path.stat().st_size} bytes")
            return None, None
        
        logger.info(f"✅ 영상 생성 완료: {output_path}")
        return str(output_path), thumbnail_path
        
    except Exception as e:
        logger.error(f"❌ 영상 생성 실패: {e}", exc_info=True)
        return None, None


def generate_shorts(bno: int) -> Dict[str, Any]:
    """쇼츠 생성 메인 (status: 0→1 or 9)"""
    try:
        persona_manager.fetch_all_personas()
        
        target = get_target_by_bno(bno)
        if not target:
            return {"success": False, "message": f"대상 없음: bno={bno}"}
        
        if target["status"] != 0:
            return {"success": False, "message": f"이미 처리됨: status={target['status']}"}
        
        video_path, thumbnail_path = render_video_with_persona(
            title=target["title"],
            content=target["content"],
            video_type=target["video_type"],
            p_id=target["p_id"],
            bno=bno
        )
        
        if not video_path:
            update_queue_status(bno, 9, error_msg="영상 생성 실패")
            return {"success": False, "message": "영상 생성 실패"}
        
        update_queue_status(bno, 1, video_path, thumbnail_path)
        insert_upload_schedule(bno)
        
        return {
            "success": True,
            "bno": bno,
            "video_path": video_path,
            "thumbnail_path": thumbnail_path
        }
        
    except Exception as e:
        logger.error(f"쇼츠 생성 실패: {e}", exc_info=True)
        update_queue_status(bno, 9, error_msg=str(e))
        return {"success": False, "message": str(e)}


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python shorts_generator.py <bno>")
        sys.exit(1)
    
    bno = int(sys.argv[1])
    result = generate_shorts(bno)
    print(result)
