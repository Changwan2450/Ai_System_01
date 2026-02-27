"""
AI 쇼츠 영상 자동 생성 모듈 (Edge-TTS 무제한 버전)
"""
import sys
import os
import time
import logging
import asyncio
from typing import Optional, Dict, Any
from pathlib import Path

import requests
from duckduckgo_search import DDGS
import edge_tts
from moviepy import ImageClip, TextClip, CompositeVideoClip, ColorClip, AudioFileClip

# 설정 파일 로드
import config

# ImageMagick 경로 설정
os.environ["IMAGEMAGICK_BINARY"] = config.IMAGEMAGICK_PATH

logging.basicConfig(level=logging.INFO, format=config.LOG_FORMAT)
logger = logging.getLogger(__name__)


async def generate_voice(text: str, output_path: Path):
    """Edge-TTS를 사용하여 음성 생성 (무료/무제한)"""
    # SunHi: 여성, InJun: 남성
    communicate = edge_tts.Communicate(text, "ko-KR-SunHiNeural")
    await communicate.save(str(output_path))
    logger.info(f"🎙️ Edge-TTS 음성 생성 완료")


def fetch_image(query: str) -> Optional[str]:
    """주제에 맞는 이미지 검색"""
    try:
        with DDGS() as ddgs:
            search_query = f"{query} tech wallpaper"
            results = list(ddgs.images(search_query, max_results=1))
            if not results: return None

            img_url = results[0]['image']
            img_path = config.ASSETS_DIR / f"bg_{int(time.time())}.jpg"

            response = requests.get(img_url, timeout=10)
            img_path.write_bytes(response.content)
            return str(img_path)
    except Exception as e:
        logger.error(f"⚠️ 이미지 수집 실패: {e}")
        return None


def create_shorts(img_path: Optional[str], title: str, content: str, vid_name: str) -> Dict[str, Any]:
    """영상 렌더링"""
    result = {"success": False, "output_path": None, "error": None}
    audio_path = config.TEMP_DIR / f"voice_{int(time.time())}.mp3"

    try:
        # 1. TTS 생성 (비동기 실행)
        asyncio.run(generate_voice(content, audio_path))

        audio_clip = AudioFileClip(str(audio_path))
        duration = audio_clip.duration + 0.8  # 여유 시간 추가

        # 2. 배경 (쇼츠 규격 1080x1920)
        if img_path and Path(img_path).exists():
            bg = ImageClip(img_path).with_duration(duration).resized(height=1920)
            if bg.w < 1080: bg = bg.resized(width=1080)
            overlay = ColorClip(size=(1080, 1920), color=(0, 0, 0)).with_duration(duration).with_opacity(0.5)
            base = CompositeVideoClip([bg.with_position('center'), overlay])
        else:
            base = ColorClip(size=(1080, 1920), color=(15, 15, 25)).with_duration(duration)

        # 3. 자막 (config.FONT_PATH 사용)
        t_clip = TextClip(
            text=title, font=config.FONT_PATH, font_size=85, color='yellow',
            method='caption', size=(950, None)
        ).with_duration(duration).with_position(('center', 350))

        c_clip = TextClip(
            text=content, font=config.FONT_PATH, font_size=55, color='white',
            method='caption', size=(850, None)
        ).with_duration(duration).with_position('center')

        # 4. 최종 합성 및 저장
        final = CompositeVideoClip([base, t_clip, c_clip]).with_audio(audio_clip)
        out_path = config.OUTPUT_DIR / vid_name

        logger.info(f"🎬 렌더링 가동: {vid_name}")
        final.write_videofile(
            str(out_path), fps=24, codec="libx264", audio_codec="aac",
            threads=8, preset="ultrafast", logger=None
        )

        result.update({"success": True, "output_path": str(out_path)})

    except Exception as e:
        logger.error(f"❌ 렌더링 실패: {e}")
        result["error"] = str(e)
    finally:
        if audio_path.exists(): audio_path.unlink()

    return result


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python make_shorts.py '제목' '내용'")
        sys.exit(1)

    res = create_shorts(fetch_image(sys.argv[1]), sys.argv[1], sys.argv[2], f"RESULT_{int(time.time())}.mp4")
    print(res)
