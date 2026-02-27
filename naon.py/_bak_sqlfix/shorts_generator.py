"""
AI 쇼츠 생성 메인 모듈 (edge-tts 무료 버전 + gTTS 폴백)
- Ken Burns 효과, 멀티 배경 이미지, 인트로/아웃트로, BGM 지원
"""
import os
import re
import json
import logging
import asyncio
import time
import random
import struct
import subprocess
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path

import numpy as np
import requests
import sqlalchemy
from sqlalchemy.engine import Engine
import edge_tts
from gtts import gTTS
from duckduckgo_search import DDGS
from PIL import Image

from moviepy.video.io.VideoFileClip import VideoFileClip
from moviepy.video.VideoClip import TextClip, ColorClip, ImageClip, VideoClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.audio.AudioClip import CompositeAudioClip

from config import (
    BASE_DIR, OUTPUT_DIR, TEMP_DIR, ASSETS_DIR, FONT_PATH,
    DB_CONNECTION_STRING,
    OPENAI_API_KEY, OPENAI_API_URL, OPENAI_MODEL,
    LOG_FORMAT, LOG_LEVEL
)
from persona_manager import persona_manager
from thumbnail_generator import ThumbnailGenerator
from upload_scheduler import UploadScheduler

# ===============================
# 로깅 설정
# ===============================
logging.basicConfig(
    level=LOG_LEVEL,
    format=LOG_FORMAT,
    handlers=[
        logging.FileHandler(BASE_DIR / "shorts_generator.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# DB 엔진
engine: Engine = sqlalchemy.create_engine(DB_CONNECTION_STRING)

# BGM 경로 (assets/bgm.mp3 가 있으면 자동 사용)
BGM_PATH: Path = ASSETS_DIR / "bgm.mp3"

# 렌더링 상수
INTRO_DURATION: float = 2.5
OUTRO_DURATION: float = 3.0
CROSSFADE_DURATION: float = 0.5
KEN_BURNS_ZOOM: float = 1.15  # 15% 줌
BGM_VOLUME: float = 0.12  # BGM 볼륨 (12%)
VIDEO_WIDTH: int = 1080
VIDEO_HEIGHT: int = 1920
VIDEO_FPS: int = 24


# ===============================
# DB 함수
# ===============================
# 인덱스 권장: CREATE INDEX idx_shorts_queue_bno_status ON shorts_queue(bno, status);
#             CREATE INDEX idx_ai_board_bno ON AI_BOARD(bno);

def get_target_by_bno(bno: int) -> Optional[Dict[str, Any]]:
    """
    특정 BNO로 게시글 정보 조회 (shorts_queue에서 status=0인 것만)
    - 중복 레코드 대응: sq_no 내림차순으로 최신 1건만 선택
    - 조회 실패 시 원인 진단 로그 출력
    """
    bno = int(bno)  # Java Long 등 타입 안전 보장

    # ROW_NUMBER()로 중복 제거: 동일 BNO 중 최신 sq_no(가장 높은 번호) 1건만 선택
    # PR-JUDGE: judge_verdict='PASS' 필터 추가
    query: str = """
                 SELECT bno, title, content, shorts_script,
                        p_id, writer, hit,
                        sq_no, video_type, quality_score, priority
                 FROM (
                     SELECT b.bno, b.title, b.content, b.shorts_script,
                            b.p_id, b.writer, b.hit,
                            q.sq_no, q.video_type, q.quality_score, q.priority,
                            ROW_NUMBER() OVER (
                                PARTITION BY q.bno
                                ORDER BY q.priority DESC, q.sq_no DESC
                            ) AS rn
                     FROM AI_BOARD b
                     JOIN shorts_queue q ON b.bno = q.bno
                     WHERE b.bno = :bno
                       AND q.status = 0
                       AND q.judge_verdict = 'PASS'
                 )
                 WHERE rn = 1
                 FETCH FIRST 1 ROW ONLY
                 """

    try:
        with engine.connect() as conn:
            result = conn.execute(sqlalchemy.text(query), {"bno": bno}).fetchone()

            if result is not None:
                data: Dict[str, Any] = dict(result._mapping)
                logger.info(
                    f"타겟 포착: BNO={bno}, SQ_NO={data.get('sq_no')}, "
                    f"TYPE={data.get('video_type')}, PRIORITY={data.get('priority')}, "
                    f"QUALITY={data.get('quality_score')}"
                )
                return data

            # ========== 조회 실패 원인 진단 ==========
            logger.warning(f"BNO={bno} JOIN 결과 없음 - 원인 진단 시작")

            # 진단 1: AI_BOARD에 해당 BNO 존재 여부
            board_row = conn.execute(
                sqlalchemy.text("SELECT bno, title FROM AI_BOARD WHERE bno = :bno"),
                {"bno": bno}
            ).fetchone()

            if board_row is None:
                logger.error(f"[진단] AI_BOARD에 BNO={bno} 존재하지 않음")
            else:
                logger.debug(f"[진단] AI_BOARD 확인: BNO={bno}, TITLE={board_row[1]}")

            # 진단 2: shorts_queue에 해당 BNO의 모든 레코드 확인 (PR-JUDGE: judge_verdict 포함)
            queue_rows = conn.execute(
                sqlalchemy.text(
                    "SELECT sq_no, status, video_type, priority, judge_verdict "
                    "FROM shorts_queue WHERE bno = :bno ORDER BY sq_no DESC"
                ),
                {"bno": bno}
            ).fetchall()

            if not queue_rows:
                logger.error(f"[진단] shorts_queue에 BNO={bno} 레코드 없음")
            else:
                for qr in queue_rows:
                    logger.warning(
                        f"[진단] shorts_queue: BNO={bno}, SQ_NO={qr[0]}, "
                        f"STATUS={qr[1]}, TYPE={qr[2]}, PRIORITY={qr[3]}, JUDGE={qr[4]}"
                    )
                statuses = [qr[1] for qr in queue_rows]
                if 0 not in statuses:
                    logger.error(
                        f"[진단] BNO={bno}: shorts_queue에 {len(queue_rows)}건 존재하나 "
                        f"status=0인 레코드 없음 (statuses={statuses})"
                    )
                else:
                    # PR-JUDGE: status=0이지만 judge_verdict가 PASS가 아닌 경우
                    status_0_rows = [qr for qr in queue_rows if qr[1] == 0]
                    non_pass = [qr for qr in status_0_rows if qr[4] != 'PASS']
                    if non_pass:
                        logger.warning(
                            f"[진단] BNO={bno}: status=0이나 judge_verdict != 'PASS' → "
                            f"{len(non_pass)}건 (verdicts={[qr[4] for qr in non_pass]})"
                        )

                # 진단 3: AI_BOARD에 없는데 shorts_queue에만 있는 고아 레코드 처리
                if board_row is None and queue_rows:
                    logger.error(
                        f"[진단] 고아 레코드 발견: shorts_queue에 BNO={bno} "
                        f"{len(queue_rows)}건 존재하나 AI_BOARD에 없음 → status=9 처리"
                    )
                    _mark_orphan_queue(conn, bno)

            return None

    except Exception as e:
        logger.error(f"DB 조회 에러 (BNO={bno}): {type(e).__name__}: {e}", exc_info=True)
        return None


def _mark_orphan_queue(conn, bno: int) -> None:
    """AI_BOARD에 없는 고아 shorts_queue 레코드를 status=9로 처리"""
    try:
        with conn.begin():
            result = conn.execute(
                sqlalchemy.text(
                    "UPDATE shorts_queue SET status = 9 WHERE bno = :bno AND status = 0"
                ),
                {"bno": bno}
            )
        logger.warning(f"고아 레코드 정리 완료: BNO={bno}, {result.rowcount}건 → status=9")
    except Exception as e:
        logger.error(f"고아 레코드 정리 실패 (BNO={bno}): {e}", exc_info=True)


def update_shorts_queue(bno: int, video_path: str, thumbnail_path: str) -> bool:
    """제작 완료 후 DB 업데이트"""
    query: str = """
                 UPDATE shorts_queue
                 SET status = 1,
                     video_path = :video_path,
                     thumbnail_path = :thumbnail_path,
                     completed_date = SYSDATE
                 WHERE bno = :bno AND status = 0
                 """

    try:
        with engine.connect() as conn:
            with conn.begin():
                result = conn.execute(
                    sqlalchemy.text(query),
                    {"video_path": video_path, "thumbnail_path": thumbnail_path, "bno": bno}
                )

        if result.rowcount > 0:
            logger.info(f"DB 업데이트 완료: BNO={bno}")
            return True
        else:
            logger.warning(f"업데이트 대상 없음: BNO={bno}")
            return False
    except Exception as e:
        logger.error(f"DB 업데이트 에러: {e}", exc_info=True)
        return False


# ===============================
# 배경 이미지 검색 및 처리 (멀티 이미지)
# ===============================
def fetch_background_images(query: str, bno: int, count: int = 3) -> List[Path]:
    """
    주제에 맞는 배경 이미지를 DuckDuckGo에서 여러 장 검색.
    Ken Burns 효과에 사용할 다양한 이미지를 확보한다.
    """
    images: List[Path] = []
    try:
        with DDGS() as ddgs:
            search_query = f"{query} technology wallpaper dark"
            results = list(ddgs.images(search_query, max_results=count + 3))
            if not results:
                logger.warning(f"BNO={bno}: 배경 이미지 검색 결과 없음")
                return images

            for idx, result in enumerate(results):
                if len(images) >= count:
                    break
                try:
                    img_url = result['image']
                    resp = requests.get(img_url, timeout=8)
                    resp.raise_for_status()

                    img_path = ASSETS_DIR / f"bg_{bno}_{idx}_{int(time.time())}.jpg"
                    img_path.write_bytes(resp.content)

                    img = Image.open(img_path).convert("RGB")
                    if img.size[0] < 200 or img.size[1] < 200:
                        img_path.unlink(missing_ok=True)
                        continue

                    # Ken Burns용으로 15% 크게 저장 (줌 여유)
                    big_w = int(VIDEO_WIDTH * KEN_BURNS_ZOOM)
                    big_h = int(VIDEO_HEIGHT * KEN_BURNS_ZOOM)
                    img = _crop_to_shorts(img, big_w, big_h)
                    img.save(str(img_path), quality=90)

                    images.append(img_path)
                    logger.info(f"BNO={bno}: 배경 이미지 {len(images)}/{count} 확보")
                except Exception:
                    continue

        logger.info(f"BNO={bno}: 총 {len(images)}장 배경 이미지 확보")
        return images
    except Exception as e:
        logger.warning(f"BNO={bno}: 배경 이미지 검색 실패: {e}")
        return images


def _crop_to_shorts(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """이미지를 target 비율로 center crop 후 리사이즈"""
    w, h = img.size
    target_ratio = target_w / target_h
    current_ratio = w / h

    if current_ratio > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))

    return img.resize((target_w, target_h), Image.LANCZOS)


# ===============================
# Ken Burns 효과
# ===============================
def _create_ken_burns_clip(
        img_path: Path,
        duration: float,
        direction: str = "in"
) -> VideoClip:
    """
    정지 이미지에 Ken Burns 줌 인/아웃 효과를 적용한 VideoClip 생성.
    이미지는 이미 KEN_BURNS_ZOOM 비율로 크게 저장되어 있어야 한다.
    """
    img = Image.open(str(img_path)).convert("RGB")
    base_frame = np.array(img)
    bh, bw = base_frame.shape[:2]
    tw, th = VIDEO_WIDTH, VIDEO_HEIGHT
    max_dx = bw - tw
    max_dy = bh - th

    def make_frame(t):
        progress = min(t / duration, 1.0) if duration > 0 else 0.0
        if direction == "out":
            progress = 1.0 - progress

        # 줌 인: 시작=전체 보기 → 끝=중앙 확대
        crop_w = int(bw - max_dx * progress)
        crop_h = int(bh - max_dy * progress)
        x1 = (bw - crop_w) // 2
        y1 = (bh - crop_h) // 2

        cropped = base_frame[y1:y1 + crop_h, x1:x1 + crop_w]

        pil_crop = Image.fromarray(cropped)
        pil_crop = pil_crop.resize((tw, th), Image.LANCZOS)
        return np.array(pil_crop)

    clip = VideoClip(make_frame, duration=duration)
    clip.fps = VIDEO_FPS
    clip.size = (tw, th)
    return clip


def _create_fallback_bg(duration: float, video_type: str) -> CompositeVideoClip:
    """배경 이미지가 없을 때 Dark Cinematic 그라데이션 배경 생성"""
    # Navy Gradient: 상단 진한 네이비 → 하단 더 진한 다크
    if video_type == 'AGRO':
        top_color = (15, 20, 45)      # 딥 네이비
        bottom_color = (5, 5, 15)     # 거의 블랙
    else:
        top_color = (10, 15, 35)      # 다크 네이비
        bottom_color = (5, 8, 20)     # 딥 다크

    # numpy로 세로 그라데이션 생성
    gradient = np.zeros((VIDEO_HEIGHT, VIDEO_WIDTH, 3), dtype=np.uint8)
    for y in range(VIDEO_HEIGHT):
        ratio = y / VIDEO_HEIGHT
        r = int(top_color[0] + (bottom_color[0] - top_color[0]) * ratio)
        g = int(top_color[1] + (bottom_color[1] - top_color[1]) * ratio)
        b = int(top_color[2] + (bottom_color[2] - top_color[2]) * ratio)
        gradient[y, :] = (r, g, b)

    bg = ImageClip(gradient).set_duration(duration)
    bg.fps = VIDEO_FPS
    return bg


# ===============================
# BGM 자동 생성
# ===============================
def _generate_ambient_bgm(output_path: Path, duration: float = 90.0) -> bool:
    """
    numpy로 부드러운 앰비언트 패드 BGM 자동 생성.
    Am 코드 기반 + 디튜닝 + LFO 모듈레이션 → 따뜻한 배경음.
    assets/bgm.mp3가 없을 때 자동으로 호출된다.
    """
    try:
        sr = 44100
        samples = int(sr * duration)
        t = np.linspace(0, duration, samples, endpoint=False)

        signal = np.zeros(samples, dtype=np.float64)

        # Am 코드: A3(220), C4(261.63), E4(329.63) + 옥타브 위 A4(440)
        chord_freqs = [220.0, 261.63, 329.63, 440.0]

        for freq in chord_freqs:
            # 각 음에 미세한 디튜닝 3개 → 풍성한 패드 사운드
            for detune in [-1.2, 0.0, 1.2]:
                f = freq + detune
                # 각 보이스마다 다른 속도의 LFO (느린 울렁임)
                lfo_rate = 0.04 + (freq % 7) * 0.01
                lfo = 0.55 + 0.45 * np.sin(2 * np.pi * lfo_rate * t)
                signal += lfo * np.sin(2 * np.pi * f * t)

        # 고역 살짝 추가 (공기감)
        air = 0.15 * np.sin(2 * np.pi * 659.25 * t)  # E5
        air *= 0.4 + 0.6 * np.sin(2 * np.pi * 0.02 * t)
        signal += air

        # 노멀라이즈
        peak = np.max(np.abs(signal))
        if peak > 0:
            signal = signal / peak

        # 페이드 인 (4초) / 페이드 아웃 (4초)
        fade_in = int(4.0 * sr)
        fade_out = int(4.0 * sr)
        signal[:fade_in] *= np.linspace(0, 1, fade_in)
        signal[-fade_out:] *= np.linspace(1, 0, fade_out)

        # 전체 볼륨 조절 (너무 크지 않게)
        signal *= 0.5

        # 16-bit PCM WAV 작성
        pcm = (signal * 32767).astype(np.int16)
        wav_path = output_path.with_suffix('.wav')

        with open(wav_path, 'wb') as f:
            data_size = len(pcm) * 2
            # RIFF header
            f.write(b'RIFF')
            f.write(struct.pack('<I', 36 + data_size))
            f.write(b'WAVE')
            # fmt chunk
            f.write(b'fmt ')
            f.write(struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * 2, 2, 16))
            # data chunk
            f.write(b'data')
            f.write(struct.pack('<I', data_size))
            f.write(pcm.tobytes())

        # ffmpeg로 WAV → MP3 변환
        result = subprocess.run(
            ['ffmpeg', '-i', str(wav_path), '-y', '-q:a', '5', str(output_path)],
            capture_output=True, timeout=30
        )
        wav_path.unlink(missing_ok=True)

        if output_path.exists():
            logger.info(f"앰비언트 BGM 자동 생성 완료: {output_path} ({duration}초)")
            return True
        else:
            logger.warning(f"BGM MP3 변환 실패: ffmpeg 종료코드={result.returncode}")
            return False

    except Exception as e:
        logger.warning(f"BGM 자동 생성 실패: {e}")
        return False


def ensure_bgm() -> Path:
    """BGM 파일이 없으면 자동 생성. BGM 경로 반환."""
    if not BGM_PATH.exists():
        logger.info("BGM 파일 없음 → 앰비언트 BGM 자동 생성 중...")
        _generate_ambient_bgm(BGM_PATH, duration=90.0)
    return BGM_PATH


# ===============================
# 인트로/아웃트로 화면
# ===============================
def _create_intro_clip(title: str, video_type: str) -> CompositeVideoClip:
    """인트로 화면: Dark Cinematic 배경 + 채널명 + 제목 (2.5초)"""
    dur = INTRO_DURATION

    # Dark Cinematic Navy 그라데이션 배경
    gradient = np.zeros((VIDEO_HEIGHT, VIDEO_WIDTH, 3), dtype=np.uint8)
    top = (15, 20, 50)
    bot = (5, 5, 18)
    for y in range(VIDEO_HEIGHT):
        ratio = y / VIDEO_HEIGHT
        gradient[y, :] = (
            int(top[0] + (bot[0] - top[0]) * ratio),
            int(top[1] + (bot[1] - top[1]) * ratio),
            int(top[2] + (bot[2] - top[2]) * ratio),
        )
    bg = ImageClip(gradient).set_duration(dur)
    bg.fps = VIDEO_FPS

    # 채널명 그림자 (오프셋 +3px)
    channel_shadow = (
        TextClip(
            txt="AI INSIDER",
            fontsize=90,
            color='#111122',
            font=FONT_PATH,
            method='caption',
            size=(900, None)
        )
        .set_duration(dur)
        .set_position(('center', 753))
    )
    channel_clip = (
        TextClip(
            txt="AI INSIDER",
            fontsize=90,
            color='white',
            font=FONT_PATH,
            stroke_color='#222244',
            stroke_width=2,
            method='caption',
            size=(900, None)
        )
        .set_duration(dur)
        .set_position(('center', 750))
    )

    # 제목 (최대 40자) - #FFD100 강조색
    short_title = title[:40] + "..." if len(title) > 40 else title
    title_shadow = (
        TextClip(
            txt=short_title,
            fontsize=55,
            color='#111122',
            font=FONT_PATH,
            method='caption',
            size=(900, None)
        )
        .set_duration(dur)
        .set_position(('center', 903))
    )
    title_clip = (
        TextClip(
            txt=short_title,
            fontsize=55,
            color='#FFD100',
            font=FONT_PATH,
            stroke_color='#1a1a2e',
            stroke_width=2,
            method='caption',
            size=(900, None)
        )
        .set_duration(dur)
        .set_position(('center', 900))
    )

    # 타입 뱃지
    badge_text = "BREAKING" if video_type == 'AGRO' else "TECH INSIGHT"
    badge_color = '#FF9F43' if video_type == 'AGRO' else '#88D8B0'
    badge_clip = (
        TextClip(
            txt=badge_text,
            fontsize=35,
            color=badge_color,
            font=FONT_PATH,
            method='caption',
            size=(400, None)
        )
        .set_duration(dur)
        .set_position(('center', 1050))
    )

    # 하단 라인 장식
    line = ColorClip(
        size=(600, 3), color=(80, 100, 180)
    ).set_duration(dur).set_position(('center', 1020))

    return CompositeVideoClip([
        bg, channel_shadow, channel_clip,
        line, title_shadow, title_clip, badge_clip
    ]).set_duration(dur)


def _create_outro_clip(video_type: str) -> CompositeVideoClip:
    """아웃트로 화면: Dark Cinematic + CTA (3초)"""
    dur = OUTRO_DURATION

    # Navy 그라데이션 배경
    gradient = np.zeros((VIDEO_HEIGHT, VIDEO_WIDTH, 3), dtype=np.uint8)
    top = (12, 15, 40)
    bot = (5, 5, 15)
    for y in range(VIDEO_HEIGHT):
        ratio = y / VIDEO_HEIGHT
        gradient[y, :] = (
            int(top[0] + (bot[0] - top[0]) * ratio),
            int(top[1] + (bot[1] - top[1]) * ratio),
            int(top[2] + (bot[2] - top[2]) * ratio),
        )
    bg = ImageClip(gradient).set_duration(dur)
    bg.fps = VIDEO_FPS

    # CTA 그림자
    cta_shadow = (
        TextClip(
            txt="구독 & 좋아요",
            fontsize=80,
            color='#111122',
            font=FONT_PATH,
            method='caption',
            size=(900, None)
        )
        .set_duration(dur)
        .set_position(('center', 803))
    )
    cta_clip = (
        TextClip(
            txt="구독 & 좋아요",
            fontsize=80,
            color='white',
            font=FONT_PATH,
            stroke_color='#222244',
            stroke_width=2,
            method='caption',
            size=(900, None)
        )
        .set_duration(dur)
        .set_position(('center', 800))
    )

    line = ColorClip(
        size=(500, 3), color=(80, 100, 180)
    ).set_duration(dur).set_position(('center', 920))

    sub_cta = (
        TextClip(
            txt="AI 기술 소식을 가장 빠르게",
            fontsize=40,
            color='#8888AA',
            font=FONT_PATH,
            method='caption',
            size=(800, None)
        )
        .set_duration(dur)
        .set_position(('center', 950))
    )

    logo_clip = (
        TextClip(
            txt="AI INSIDER",
            fontsize=50,
            color='#4ECDC4',
            font=FONT_PATH,
            stroke_color='#1a1a2e',
            stroke_width=1,
            method='caption',
            size=(600, None)
        )
        .set_duration(dur)
        .set_position(('center', 1050))
    )

    return CompositeVideoClip([
        bg, cta_shadow, cta_clip, line, sub_cta, logo_clip
    ]).set_duration(dur)


# ===============================
# 대본 후처리 (URL/사이트명 제거 - 강화)
# ===============================
_URL_PATTERN = re.compile(r'https?://\S+|www\.\S+', re.IGNORECASE)
_SITE_NAMES = re.compile(
    r'\b(TechCrunch|BBC|Reuters|ArsTechnica|The Verge|Wired|CNBC|Bloomberg|'
    r'MIT Technology Review|VentureBeat|Engadget|ZDNet|CNET|Mashable|'
    r'TechRadar|Gizmodo|9to5Mac|9to5Google|The Information|Axios|'
    r'Wall Street Journal|New York Times|Washington Post|Guardian|'
    r'Forbes|Fortune|Business Insider|'
    r'출처\s*[:：].*?[.。\n]|참고\s*[:：].*?[.。\n]|'
    r'according to\s+\w+|보도에 따르면|보도했다|보도함|발표했다)\b',
    re.IGNORECASE
)
_DOMAIN_PATTERN = re.compile(
    r'\S+\.(com|org|net|io|co\.kr|ai|dev|tech|news)\b',
    re.IGNORECASE
)
_BRACKET_SOURCE = re.compile(r'\[.*?(출처|source|참고|via).*?\]', re.IGNORECASE)
# LLM_POLICY 금지 표현 (진부한 감탄사)
_BANNED_PHRASES = re.compile(r'ㄹㅇ|실화냐|실화야|대박|헐\b')


def _sanitize_text(text: str) -> str:
    """텍스트에서 URL, 사이트명, 도메인, 출처, 금지 표현 제거"""
    text = _URL_PATTERN.sub('', text)
    text = _SITE_NAMES.sub('', text)
    text = _DOMAIN_PATTERN.sub('', text)
    text = _BRACKET_SOURCE.sub('', text)
    text = _BANNED_PHRASES.sub('', text)
    text = re.sub(r'\s{2,}', ' ', text).strip()
    return text


def _sanitize_script(script_data: Dict[str, Any]) -> Dict[str, Any]:
    """대본 JSON의 모든 텍스트 필드에서 URL/사이트명 제거"""
    for key, value in script_data.items():
        if isinstance(value, str):
            script_data[key] = _sanitize_text(value)
        elif isinstance(value, list):
            script_data[key] = [_sanitize_text(v) if isinstance(v, str) else v for v in value]
    return script_data


# ===============================
# OpenAI 대본 생성 (PR-PHASE2: AI 떡밥 전용 엔진)
# ===============================
def generate_script_with_openai(
        target_data: Dict[str, Any],
        video_type: str
) -> Optional[Dict[str, Any]]:
    """
    PR-PHASE2: AI 떡밥 전용 숏츠 대본 생성
    - 자극적이고 논쟁 유도형
    - 커뮤니티 말투 (님들, 와 이거, 솔직히 이건)
    - 한 문장 20자 전후, 빠른 템포
    """
    p_id: str = target_data.get("p_id", "")
    persona = persona_manager.get_persona(p_id)

    persona_style = persona_manager.get_script_style(p_id) if persona else "커뮤니티 인사이더"
    quality_score = target_data.get("quality_score", 5.0)

    # PR-PHASE2: 공통 시스템 프롬프트 (떡밥 엔진)
    system_prompt = (
        "당신은 'AI 떡밥 전문 크리에이터'입니다.\n"
        "정보 요약이 아니라, 논쟁과 댓글을 유도하는 자극적 대본을 만듭니다.\n\n"
        "규칙:\n"
        "- 커뮤니티 말투 필수: '님들', '와 이거', '솔직히 이건', '그니까 말이지'\n"
        "- 한 문장 20자 전후, 최대 25자\n"
        "- 빠른 템포, 끊어 읽기\n"
        "- 뉴스톤 금지, 너무 공손한 말투 금지\n"
        "- 단정적 표현 완화 ('~할 수도', '~라는 얘기가', '~인 듯')\n"
        "- 법적 리스크 회피: 단정 금지, 추측/소문 형태로\n"
    )

    # PR-PHASE2: 통합 프롬프트 (AGRO/INFO 구분 없이 동일 구조)
    user_prompt = f"""
주제: {target_data.get('title', '')}
내용: {target_data.get('content', '')[:500]}
스타일: {persona_style}
품질: {quality_score}/10

JSON 포맷 (절대 준수):
{{
  "hook": "감탄형/충격형 시작 (15-25자)",
  "core_summary": "핵심 요약, 떡밥 포인트 (40-60자)",
  "controversy_point": "논쟁/의견 대립 유도 (30-50자)",
  "comment_trigger": "질문형 마무리 (15-25자)"
}}

작성 규칙:

1. hook (감탄형/충격형 필수)
   - "와 님들 이거 진짜?"
   - "어 이거 뭐야 갑자기"
   - "솔직히 이건 좀 아닌 듯"
   - "그니까 말이지 이게"
   예: "와 님들 AI가 또 사고쳤네"

2. core_summary (떡밥 핵심)
   - 한 문장 20자 전후로 끊어서 3개
   - "~라는 얘기가 나왔어.", "~인 듯.", "~할 수도 있대."
   예: "그니까 이번에 오픈AI가. 새로운 모델 풀었는데. 사람보다 잘한다는 거야."

3. controversy_point (논쟁 유도)
   - 양쪽 의견 제시
   - "근데 어떤 사람들은 ~라고 하고."
   - "반대로 ~라는 의견도 있어."
   예: "근데 어떤 개발자들은. 이거 별로래. 반대로 실무자들은. 개이득이라는데."

4. comment_trigger (질문형 필수)
   - 반드시 질문으로 끝
   - "너희는 어떻게 생각해?"
   - "댓글로 의견 좀 남겨줘"
   - "이거 어디까지 믿어야 할까?"
   예: "님들 생각은 어때?"

절대 금지:
- "ㄹㅇ", "실화냐", "대박", "충격", "헐"
- 출처, URL, 사이트명, "~에 따르면"
- 20자 초과 긴 문장
- 뉴스 앵커 톤
- 단정적 법적 리스크 표현 ("확실하다", "분명하다", "틀림없다")

허용:
- 추측 표현 ("~인 듯", "~라는 얘기", "~할 수도")
- 커뮤니티 은어 적당히
- 기술 용어 (AI, GPU, API 등)

총 길이: 40-60초 (TTS 1.25x 속도 기준)
"""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }

    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.8,  # PR-PHASE2: 창의성 증가 (0.7 → 0.8)
        "max_tokens": 1000   # PR-PHASE2: 토큰 절약 (1500 → 1000)
    }

    try:
        logger.info(f"[PR-PHASE2] 떡밥 대본 생성 중 (TYPE={video_type})...")

        response = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()

        data = response.json()
        raw_text: str = data['choices'][0]['message']['content'].strip()

        clean_json: str = raw_text.replace("```json", "").replace("```", "").strip()
        script_data: Dict[str, Any] = json.loads(clean_json)

        # PR-PHASE2: 필수 필드 검증
        required_fields = ["hook", "core_summary", "controversy_point", "comment_trigger"]
        for field in required_fields:
            if field not in script_data or not script_data[field]:
                logger.error(f"[PR-PHASE2] 필수 필드 누락: {field}")
                return None

        # 후처리: URL, 사이트명, 출처 표현 제거
        script_data = _sanitize_script(script_data)

        # PR-PHASE2: 검증 로그
        logger.info(f"[PR-PHASE2] 떡밥 대본 생성 완료:")
        logger.info(f"  - hook: {script_data['hook'][:30]}...")
        logger.info(f"  - core_summary: {script_data['core_summary'][:40]}...")
        logger.info(f"  - controversy_point: {script_data['controversy_point'][:30]}...")
        logger.info(f"  - comment_trigger: {script_data['comment_trigger']}")

        return script_data

    except Exception as e:
        logger.error(f"[PR-PHASE2] 대본 생성 실패: {e}", exc_info=True)
        return None


# ===============================
# TTS 음성 생성 (edge-tts + gTTS 폴백)
# ===============================
MAX_TTS_RETRIES: int = 3
TTS_RETRY_BASE_DELAY: float = 2.0


async def generate_audio_async(
        text: str,
        voice: str,
        speed: str,
        output_path: Path
) -> bool:
    """edge-tts로 음성 생성 (비동기, 재시도 + gTTS 폴백)"""
    for attempt in range(1, MAX_TTS_RETRIES + 1):
        try:
            logger.info(f"edge-tts 시도 {attempt}/{MAX_TTS_RETRIES}: {output_path.name}")
            communicate = edge_tts.Communicate(text, voice, rate=speed)
            await communicate.save(str(output_path))
            logger.info(f"edge-tts 성공 (시도 {attempt}): {output_path.name}")
            return True
        except Exception as e:
            delay = TTS_RETRY_BASE_DELAY * (2 ** (attempt - 1))
            logger.warning(
                f"edge-tts 실패 (시도 {attempt}/{MAX_TTS_RETRIES}): {e} "
                f"| {delay:.1f}초 후 재시도" if attempt < MAX_TTS_RETRIES else
                f"edge-tts 최종 실패 (시도 {attempt}/{MAX_TTS_RETRIES}): {e}"
            )
            if attempt < MAX_TTS_RETRIES:
                await asyncio.sleep(delay)

    # gTTS 폴백
    logger.warning(f"gTTS 폴백 시도: {output_path.name}")
    try:
        tts = gTTS(text=text, lang='ko')
        tts.save(str(output_path))
        logger.info(f"gTTS 폴백 성공: {output_path.name}")
        return True
    except Exception as e:
        logger.error(f"gTTS 폴백도 실패: {e}", exc_info=True)
        return False


def generate_audio_sync(text: str, voice: str, speed: str, output_path: Path) -> bool:
    """동기 래퍼"""
    return asyncio.run(generate_audio_async(text, voice, speed, output_path))


# ===============================
# 영상 렌더링 (Ken Burns + 멀티 이미지 + 인트로/아웃트로 + BGM)
# ===============================
def render_video_with_persona(
        script_data: Dict[str, Any],
        target_data: Dict[str, Any]
) -> Optional[Dict[str, str]]:
    """
    Persona 기반 영상 렌더링 (고급 편집 파이프라인)
    - 인트로 → 본문(Ken Burns 멀티 이미지 + 자막) → 아웃트로
    - BGM 저음량 믹싱
    """
    bno: int = target_data["bno"]
    p_id: str = target_data.get("p_id", "")
    video_type: str = target_data.get("video_type", "INFO")
    title: str = target_data.get("title", "")

    output_name: Path = OUTPUT_DIR / f"shorts_{video_type}_{bno}.mp4"

    # Persona TTS 설정
    tts_config = persona_manager.get_tts_config(p_id)
    voice = tts_config["voice"]
    speed = tts_config["speed"]

    logger.info(f"edge-tts 설정: 음성={voice}, 속도={speed}")

    persona = persona_manager.get_persona(p_id)
    avatar_url = persona.get('avatar') if persona else None

    temp_files: List[Path] = []

    try:
        # ===== 1단계: 대본 텍스트 추출 (PR-PHASE2: 통합 구조) =====
        texts = [
            script_data.get("hook", ""),
            script_data.get("core_summary", ""),
            script_data.get("controversy_point", ""),
            script_data.get("comment_trigger", "")
        ]

        # 빈 텍스트 제거
        texts = [t for t in texts if t and len(t) >= 5]
        if not texts:
            logger.error(f"BNO={bno}: 유효한 대본 텍스트 없음")
            return None

        logger.info(f"[PR-PHASE2] 렌더링 파트: {len(texts)}개 (hook → core → controversy → trigger)")

        # ===== 2단계: TTS 오디오 생성 =====
        logger.info(f"TTS 오디오 생성 중 ({len(texts)}개 파트)...")

        # 각 파트별 (텍스트, 오디오파일, duration) 저장
        parts: List[Dict[str, Any]] = []

        for i, text in enumerate(texts):
            temp_audio: Path = TEMP_DIR / f"temp_{bno}_{i}.mp3"
            temp_files.append(temp_audio)

            success = generate_audio_sync(text, voice, speed, temp_audio)

            if success:
                a_clip = AudioFileClip(str(temp_audio))
                duration = a_clip.duration
                parts.append({
                    "text": text,
                    "audio_clip": a_clip,
                    "duration": duration,
                    "has_audio": True
                })
            else:
                logger.warning(f"BNO={bno} 파트 {i}: TTS 실패 - 자막만 5초")
                parts.append({
                    "text": text,
                    "audio_clip": None,
                    "duration": 5.0,
                    "has_audio": False
                })

        if not parts:
            logger.error(f"BNO={bno}: 파트가 하나도 없어 영상 생성 불가")
            return None

        # 본문 총 길이
        body_duration = sum(p["duration"] for p in parts)
        total_duration = INTRO_DURATION + body_duration + OUTRO_DURATION
        logger.info(
            f"렌더링 준비: 인트로={INTRO_DURATION}s + 본문={body_duration:.1f}s + "
            f"아웃트로={OUTRO_DURATION}s = 총 {total_duration:.1f}s"
        )

        # ===== 3단계: 배경 이미지 (멀티) =====
        bg_images = fetch_background_images(title, bno, count=min(len(parts), 3))
        for img_path in bg_images:
            temp_files.append(img_path)

        # ===== 4단계: 인트로 화면 =====
        intro_clip = _create_intro_clip(title, video_type).set_start(0)

        # ===== 5단계: 본문 - Ken Burns 배경 + 자막 합성 =====
        body_clips = []
        body_audio_clips = []
        body_sub_clips = []
        body_time = INTRO_DURATION  # 인트로 이후 시작

        # Ken Burns 방향 교대 (in → out → in → ...)
        kb_directions = ["in", "out"]

        for idx, part in enumerate(parts):
            part_dur = part["duration"]

            # 배경 이미지 선택 (순환)
            if bg_images:
                img_idx = idx % len(bg_images)
                kb_dir = kb_directions[idx % 2]

                kb_clip = _create_ken_burns_clip(
                    bg_images[img_idx], part_dur, direction=kb_dir
                ).set_start(body_time)

                # 반투명 오버레이 (자막 가독성)
                overlay = (
                    ColorClip(size=(VIDEO_WIDTH, VIDEO_HEIGHT), color=(0, 0, 0))
                    .set_duration(part_dur)
                    .set_start(body_time)
                    .set_opacity(0.45)
                )
                body_clips.append(kb_clip)
                body_clips.append(overlay)
            else:
                # fallback: 단색 배경
                fb = _create_fallback_bg(part_dur, video_type).set_start(body_time)
                body_clips.append(fb)

            # 오디오
            if part["has_audio"] and part["audio_clip"]:
                a = part["audio_clip"].set_start(body_time)
                body_audio_clips.append(a)

            # 자막 (그림자 + 본체 2레이어)
            # POLICY: white base, #FFD100 for highlights (hook/intro는 강조색)
            is_highlight = (idx == 0)  # 첫 파트(hook/intro)는 #FFD100 강조
            sub_color = '#FFD100' if is_highlight else 'white'
            sub_fontsize = 75 if video_type == 'AGRO' else 65

            # 그림자 레이어 (오프셋 +3px)
            shadow_clip = (
                TextClip(
                    txt=part["text"],
                    fontsize=sub_fontsize,
                    color='#0a0a14',
                    font=FONT_PATH,
                    method='caption',
                    size=(900, None)
                )
                .set_start(body_time)
                .set_duration(part_dur)
                .set_position(('center', 853))
            )
            body_sub_clips.append(shadow_clip)

            # 본체 레이어 (stroke + 색상)
            txt_clip = (
                TextClip(
                    txt=part["text"],
                    fontsize=sub_fontsize,
                    color=sub_color,
                    font=FONT_PATH,
                    stroke_color='#1a1a2e',
                    stroke_width=3,
                    method='caption',
                    size=(900, None)
                )
                .set_start(body_time)
                .set_duration(part_dur)
                .set_position(('center', 850))
            )
            body_sub_clips.append(txt_clip)

            body_time += part_dur

        # ===== 6단계: 아웃트로 화면 =====
        outro_clip = _create_outro_clip(video_type).set_start(body_time)

        # ===== 7단계: 전체 합성 =====
        # 비디오 레이어 순서: [인트로, 본문 배경들, 본문 자막들, 아웃트로]
        all_video_clips = [intro_clip] + body_clips + body_sub_clips + [outro_clip]
        composite = CompositeVideoClip(
            all_video_clips,
            size=(VIDEO_WIDTH, VIDEO_HEIGHT)
        ).set_duration(total_duration)

        # ===== 8단계: 오디오 믹싱 (TTS + BGM) =====
        all_audio = []

        # TTS 오디오
        if body_audio_clips:
            all_audio.extend(body_audio_clips)

        # BGM (없으면 자동 생성 후 저볼륨 믹스)
        bgm_path = ensure_bgm()
        if bgm_path.exists():
            try:
                bgm = AudioFileClip(str(bgm_path))
                if bgm.duration < total_duration:
                    bgm = bgm.set_duration(min(bgm.duration, total_duration))
                else:
                    bgm = bgm.set_duration(total_duration)

                bgm = bgm.volumex(BGM_VOLUME)
                bgm = bgm.set_start(0)
                all_audio.append(bgm)
                logger.info(f"BGM 적용: {bgm_path.name}, 볼륨={BGM_VOLUME}")
            except Exception as e:
                logger.warning(f"BGM 로드 실패 (무시): {e}")

        if all_audio:
            final_audio = CompositeAudioClip(all_audio)
            final_video = composite.set_audio(final_audio)
        else:
            final_video = composite

        # ===== 9단계: 렌더링 =====
        logger.info(f"최종 렌더링 시작 ({total_duration:.1f}초)...")
        final_video.write_videofile(
            str(output_name),
            fps=VIDEO_FPS,
            codec="libx264",
            audio_codec="aac",
            threads=8,
            preset="ultrafast",
            logger=None
        )

        # 썸네일 생성
        thumb_generator = ThumbnailGenerator()
        thumb_path = thumb_generator.create_thumbnail(
            title=title,
            video_type=video_type,
            persona_avatar_url=avatar_url,
            bno=bno
        )

        logger.info(f"영상 제작 완료: {output_name} ({total_duration:.1f}초)")

        # DB 업데이트
        update_shorts_queue(bno, str(output_name), thumb_path)

        # 업로드 스케줄링
        scheduler = UploadScheduler(engine)
        scheduled_time = scheduler.schedule_upload(bno, video_type)

        if scheduled_time:
            logger.info(f"업로드 예약: {scheduled_time}")

        return {
            "video_path": str(output_name),
            "thumbnail_path": thumb_path
        }

    except Exception as e:
        logger.error(f"렌더링 실패: {e}", exc_info=True)
        return None

    finally:
        for temp_file in temp_files:
            if temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception as e:
                    logger.warning(f"임시 파일 삭제 실패: {e}")


# ===============================
# CLI 실행
# ===============================
def main() -> None:
    """메인 실행"""
    persona_manager.fetch_all_personas()

    import sys
    if len(sys.argv) > 1:
        bno = int(sys.argv[1])
        target = get_target_by_bno(bno)

        if target:
            video_type = target.get("video_type", "INFO")
            script = generate_script_with_openai(target, video_type)

            if script:
                result = render_video_with_persona(script, target)
                if result:
                    print(f"성공: {result['video_path']}")
                else:
                    print("렌더링 실패")
            else:
                logger.error("대본 생성 실패")
        else:
            logger.error(f"BNO={bno} 없음")
    else:
        logger.error("사용법: python shorts_generator.py <bno>")


if __name__ == "__main__":
    main()
