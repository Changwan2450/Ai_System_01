"""
이미지 선택 + 영상 렌더링 로직 개선
shorts_generator.py의 fetch_background_images, render_video_with_persona 교체용
"""
import re
import logging
import random
import time
from typing import List, Dict, Any, Optional
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageFilter
from duckduckgo_search import DDGS

logger = logging.getLogger(__name__)

# 상수 (shorts_generator.py에서 import)
VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
VIDEO_FPS = 24
KEN_BURNS_ZOOM = 1.15
TEMP_DIR = Path(__file__).parent / "temp"
ASSETS_DIR = Path(__file__).parent / "assets"


def extract_nouns_from_text(text: str) -> List[str]:
    """
    텍스트에서 명사 키워드 3~5개 추출
    - 한글 2글자 이상
    - 영문 대문자 포함 3글자 이상
    - AI 관련 키워드 우선
    """
    # AI 관련 우선 키워드
    priority_keywords = [
        'AI', 'GPT', 'Claude', 'Gemini', 'ChatGPT', 'OpenAI', 'Google',
        '인공지능', '딥러닝', '머신러닝', '기술', '개발자', '스타트업',
        'API', '모델', 'NVIDIA', 'GPU', '반도체'
    ]

    found_keywords = set()

    # 우선 키워드 검색
    for keyword in priority_keywords:
        if keyword in text:
            found_keywords.add(keyword)

    # 한글 명사 (2글자 이상)
    korean_nouns = re.findall(r'[가-힣]{2,}', text)
    found_keywords.update(korean_nouns[:3])

    # 영문 키워드 (대문자 포함 3글자 이상)
    english_keywords = re.findall(r'[A-Z][A-Za-z0-9]{2,}', text)
    found_keywords.update(english_keywords[:2])

    return list(found_keywords)[:5]


def is_extreme_solid_color(img: Image.Image, threshold: float = 0.85) -> bool:
    """
    극단적 원색 이미지 필터링
    - 빨강/파랑 단색 이미지 제외
    """
    try:
        # 작은 크기로 리사이즈해서 평균 색상 계산
        small = img.resize((50, 50))
        pixels = list(small.getdata())

        # RGB 평균
        r_avg = sum(p[0] for p in pixels) / len(pixels)
        g_avg = sum(p[1] for p in pixels) / len(pixels)
        b_avg = sum(p[2] for p in pixels) / len(pixels)

        # 빨강 단색 검사 (r > 200, g < 100, b < 100)
        if r_avg > 200 and g_avg < 100 and b_avg < 100:
            return True

        # 파랑 단색 검사 (b > 200, r < 100, g < 100)
        if b_avg > 200 and r_avg < 100 and g_avg < 100:
            return True

        return False

    except Exception:
        return False


def fetch_keyword_based_images(
        keywords: List[str],
        bno: int,
        count: int = 4,
        video_type: str = "INFO"
) -> List[Path]:
    """
    키워드 기반 이미지 검색 (개선)
    - 각 파트별 키워드로 다른 이미지
    - 극단적 원색 필터링
    - fallback은 블러 처리된 관련 이미지
    """
    images = []

    try:
        # 키워드 기반 쿼리 생성
        if video_type == "AGRO":
            search_suffix = "technology dark dramatic wallpaper"
        else:
            search_suffix = "AI technology professional background"

        # 각 키워드로 검색 시도
        for keyword in keywords:
            if len(images) >= count:
                break

            search_query = f"{keyword} {search_suffix}"
            logger.info(f"이미지 검색: {search_query}")

            try:
                with DDGS() as ddgs:
                    results = list(ddgs.images(search_query, max_results=5))

                    for result in results:
                        if len(images) >= count:
                            break

                        try:
                            img_url = result['image']
                            resp = requests.get(img_url, timeout=8)
                            resp.raise_for_status()

                            img_path = ASSETS_DIR / f"bg_{bno}_{len(images)}_{int(time.time())}.jpg"
                            img_path.write_bytes(resp.content)

                            img = Image.open(img_path).convert("RGB")

                            # 필터링: 크기, 극단적 원색
                            if img.size[0] < 300 or img.size[1] < 300:
                                img_path.unlink(missing_ok=True)
                                continue

                            if is_extreme_solid_color(img):
                                logger.warning(f"극단적 원색 이미지 제외: {img_url[:50]}")
                                img_path.unlink(missing_ok=True)
                                continue

                            # Ken Burns용 크기 조정
                            big_w = int(VIDEO_WIDTH * KEN_BURNS_ZOOM)
                            big_h = int(VIDEO_HEIGHT * KEN_BURNS_ZOOM)
                            img = _crop_to_shorts(img, big_w, big_h)
                            img.save(str(img_path), quality=90)

                            images.append(img_path)
                            logger.info(f"이미지 확보: {len(images)}/{count} (키워드: {keyword})")

                        except Exception:
                            continue

            except Exception as e:
                logger.warning(f"키워드 '{keyword}' 검색 실패: {e}")
                continue

        # fallback: 관련 이미지가 하나도 없으면 기본 키워드로 재시도
        if not images:
            logger.warning("모든 키워드 검색 실패 → 기본 검색")
            fallback_query = "AI technology background dark"

            try:
                with DDGS() as ddgs:
                    results = list(ddgs.images(fallback_query, max_results=count + 2))

                    for result in results[:count]:
                        try:
                            img_url = result['image']
                            resp = requests.get(img_url, timeout=8)
                            resp.raise_for_status()

                            img_path = ASSETS_DIR / f"bg_{bno}_fb_{int(time.time())}.jpg"
                            img_path.write_bytes(resp.content)

                            img = Image.open(img_path).convert("RGB")
                            big_w = int(VIDEO_WIDTH * KEN_BURNS_ZOOM)
                            big_h = int(VIDEO_HEIGHT * KEN_BURNS_ZOOM)
                            img = _crop_to_shorts(img, big_w, big_h)

                            # fallback 이미지는 블러 처리
                            img = img.filter(ImageFilter.GaussianBlur(radius=3))
                            img.save(str(img_path), quality=90)

                            images.append(img_path)

                        except Exception:
                            continue

            except Exception as e:
                logger.warning(f"fallback 검색 실패: {e}")

        logger.info(f"총 {len(images)}개 이미지 확보 (목표: {count})")
        return images

    except Exception as e:
        logger.error(f"이미지 검색 전체 실패: {e}", exc_info=True)
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


def create_dynamic_ken_burns_clip(
        img_path: Path,
        duration: float,
        part_index: int
) -> 'VideoClip':
    """
    다이나믹 Ken Burns 효과
    - 파트별 다른 방향 (in/out/pan-left/pan-right)
    """
    from moviepy.video.VideoClip import VideoClip

    img = Image.open(str(img_path)).convert("RGB")
    base_frame = np.array(img)
    bh, bw = base_frame.shape[:2]
    tw, th = VIDEO_WIDTH, VIDEO_HEIGHT
    max_dx = bw - tw
    max_dy = bh - th

    # 파트별 효과 패턴
    patterns = ["zoom_in", "zoom_out", "pan_left", "pan_right"]
    pattern = patterns[part_index % len(patterns)]

    def make_frame(t):
        progress = min(t / duration, 1.0) if duration > 0 else 0.0

        if pattern == "zoom_in":
            # 줌 인: 전체 → 중앙 확대
            crop_w = int(bw - max_dx * progress)
            crop_h = int(bh - max_dy * progress)
            x1 = (bw - crop_w) // 2
            y1 = (bh - crop_h) // 2

        elif pattern == "zoom_out":
            # 줌 아웃: 중앙 확대 → 전체
            crop_w = int(tw + max_dx * progress)
            crop_h = int(th + max_dy * progress)
            x1 = (bw - crop_w) // 2
            y1 = (bh - crop_h) // 2

        elif pattern == "pan_left":
            # 왼쪽으로 패닝
            crop_w, crop_h = tw, th
            x1 = int(max_dx * (1 - progress))
            y1 = (bh - crop_h) // 2

        else:  # pan_right
            # 오른쪽으로 패닝
            crop_w, crop_h = tw, th
            x1 = int(max_dx * progress)
            y1 = (bh - crop_h) // 2

        # 경계 체크
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


def create_dynamic_text_overlay(
        text: str,
        duration: float,
        part_index: int,
        is_highlight: bool = False
) -> List['VideoClip']:
    """
    다이나믹 텍스트 오버레이
    - 파트별 다른 위치
    - 핵심 단어 강조
    """
    from moviepy.video.VideoClip import TextClip

    # 파트별 Y 위치 패턴
    y_positions = [750, 850, 950, 800]  # 중앙, 하단, 상단, 중앙 순환
    y_pos = y_positions[part_index % len(y_positions)]

    # 색상
    if is_highlight:
        color = '#FFD100'  # 강조색
    else:
        color = 'white'

    fontsize = 70

    clips = []

    # 그림자
    shadow = TextClip(
        txt=text,
        fontsize=fontsize,
        color='#0a0a14',
        font='/Users/changwan/Library/Fonts/D2Coding-Ver1.3.2-20180524-ligature.ttc',
        method='caption',
        size=(900, None)
    ).set_duration(duration).set_position(('center', y_pos + 3))

    clips.append(shadow)

    # 본체
    main_text = TextClip(
        txt=text,
        fontsize=fontsize,
        color=color,
        font='/Users/changwan/Library/Fonts/D2Coding-Ver1.3.2-20180524-ligature.ttc',
        stroke_color='#1a1a2e',
        stroke_width=3,
        method='caption',
        size=(900, None)
    ).set_duration(duration).set_position(('center', y_pos))

    clips.append(main_text)

    return clips
