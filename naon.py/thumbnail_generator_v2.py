"""
썸네일 자동 생성 모듈 V2 (전면 개선)
- 핵심 문장 자동 추출
- 6~9단어 강력한 훅 문장
- 대비 높은 텍스트 + 반투명 블랙 오버레이
- 인물/AI 관련 이미지 우선
- 랜덤 색상 배경 금지
"""
import logging
import re
from typing import Dict, Any, Optional, List
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import requests
from io import BytesIO
from duckduckgo_search import DDGS

from config import BASE_DIR, OUTPUT_DIR, LOG_FORMAT, LOG_LEVEL

logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)


class ThumbnailGeneratorV2:
    """AI 쇼츠 썸네일 자동 생성 V2"""

    def __init__(self):
        self.width = 1080
        self.height = 1920
        self.output_dir = OUTPUT_DIR

        # 폰트 경로
        self.font_bold = "/Users/changwan/Library/Fonts/Pretendard-Bold.otf"
        self.font_regular = "/Users/changwan/Library/Fonts/Pretendard-Regular.otf"

    def extract_hook_sentence(self, title: str, content: str) -> str:
        """
        핵심 문장 자동 추출 (6~9단어)
        - 제목에서 강력한 훅 문장 추출
        - 없으면 내용에서 추출
        """
        # 제목을 단어로 분리
        words = title.split()

        # 6~9단어로 재구성
        if len(words) >= 6:
            hook = " ".join(words[:9])
        else:
            # 제목이 짧으면 내용에서 보강
            content_words = content.split()[:5]
            hook = " ".join(words + content_words[:9 - len(words)])

        # 최대 50자로 제한
        if len(hook) > 50:
            hook = hook[:47] + "..."

        return hook

    def fetch_relevant_thumbnail_image(
            self,
            title: str,
            video_type: str,
            bno: int
    ) -> Optional[Path]:
        """
        주제 관련 썸네일 이미지 검색
        - 인물/AI 관련 이미지 우선
        - 랜덤 색상 배경 금지
        """
        try:
            # AI/기술 관련 키워드 추출
            keywords = []
            priority_words = [
                'AI', 'GPT', 'Claude', 'Gemini', 'OpenAI', 'Google',
                '인공지능', '딥러닝', '기술', '개발자'
            ]

            for word in priority_words:
                if word in title:
                    keywords.append(word)

            if not keywords:
                keywords = ['AI', 'technology']

            # 검색 쿼리
            if video_type == "AGRO":
                search_query = f"{keywords[0]} technology breaking news thumbnail"
            else:
                search_query = f"{keywords[0]} AI professional person tech"

            logger.info(f"썸네일 이미지 검색: {search_query}")

            with DDGS() as ddgs:
                results = list(ddgs.images(search_query, max_results=10))

                for result in results:
                    try:
                        img_url = result['image']
                        resp = requests.get(img_url, timeout=8)
                        resp.raise_for_status()

                        img_path = self.output_dir / f"thumb_bg_{bno}_{int(time.time())}.jpg"
                        img_path.write_bytes(resp.content)

                        img = Image.open(img_path).convert("RGB")

                        # 크기 검증
                        if img.size[0] < 500 or img.size[1] < 500:
                            img_path.unlink(missing_ok=True)
                            continue

                        # 극단적 원색 필터링
                        if self._is_extreme_color(img):
                            logger.warning("극단적 원색 배경 제외")
                            img_path.unlink(missing_ok=True)
                            continue

                        logger.info(f"썸네일 배경 이미지 확보: {img_path}")
                        return img_path

                    except Exception:
                        continue

            logger.warning("썸네일 배경 이미지 검색 실패 → fallback")
            return None

        except Exception as e:
            logger.error(f"썸네일 이미지 검색 실패: {e}")
            return None

    def _is_extreme_color(self, img: Image.Image) -> bool:
        """극단적 원색 배경 검사"""
        try:
            small = img.resize((50, 50))
            pixels = list(small.getdata())

            r_avg = sum(p[0] for p in pixels) / len(pixels)
            g_avg = sum(p[1] for p in pixels) / len(pixels)
            b_avg = sum(p[2] for p in pixels) / len(pixels)

            # 빨강/파랑 단색 검사
            if r_avg > 200 and g_avg < 100 and b_avg < 100:
                return True
            if b_avg > 200 and r_avg < 100 and g_avg < 100:
                return True

            return False

        except Exception:
            return False

    def create_thumbnail(
            self,
            title: str,
            content: str,
            video_type: str,
            bno: int = 0
    ) -> str:
        """
        썸네일 생성 V2
        - 핵심 문장 자동 추출
        - 관련 이미지 우선
        - 대비 높은 텍스트
        """
        try:
            import time

            # 1. 핵심 훅 문장 추출
            hook = self.extract_hook_sentence(title, content)
            logger.info(f"썸네일 훅 문장: {hook}")

            # 2. 배경 이미지 검색
            bg_image_path = self.fetch_relevant_thumbnail_image(title, video_type, bno)

            if bg_image_path and bg_image_path.exists():
                img = Image.open(bg_image_path).convert("RGB")

                # 9:16 비율로 crop
                img = self._crop_to_ratio(img, self.width, self.height)

                # 대비 및 선명도 향상
                enhancer = ImageEnhance.Contrast(img)
                img = enhancer.enhance(1.3)

                enhancer = ImageEnhance.Sharpness(img)
                img = enhancer.enhance(1.2)

            else:
                # fallback: Dark Gradient (단색 금지)
                img = self._create_dark_gradient_bg(video_type)

            # 3. 어두운 오버레이 (반투명 블랙)
            overlay = Image.new('RGBA', (self.width, self.height), (0, 0, 0, 160))
            img = img.convert('RGBA')
            img = Image.alpha_composite(img, overlay).convert('RGB')

            draw = ImageDraw.Draw(img)

            # 4. 타입 뱃지 (상단)
            try:
                font_badge = ImageFont.truetype(self.font_bold, 55)
            except:
                font_badge = ImageFont.load_default()

            badge_text = "🔥 긴급" if video_type == "AGRO" else "💡 심층"
            badge_color = (255, 215, 0)  # 골드

            bbox = draw.textbbox((0, 0), badge_text, font=font_badge)
            badge_w = bbox[2] - bbox[0]
            badge_h = bbox[3] - bbox[1]

            badge_x = 50
            badge_y = 100

            # 뱃지 배경
            draw.rounded_rectangle(
                [badge_x - 20, badge_y - 10, badge_x + badge_w + 20, badge_y + badge_h + 10],
                radius=15,
                fill=(255, 215, 0, 220)
            )

            # 뱃지 텍스트
            draw.text((badge_x, badge_y), badge_text, font=font_badge, fill=(20, 20, 30))

            # 5. 메인 훅 문장 (중앙, 대비 높음)
            try:
                font_main = ImageFont.truetype(self.font_bold, 95)
            except:
                font_main = ImageFont.load_default()

            # 자동 줄바꿈
            wrapped = self._wrap_text(hook, font_main, self.width - 120)

            # 텍스트 박스 크기 계산
            bbox = draw.multiline_textbbox((0, 0), wrapped, font=font_main, align='center')
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]

            text_x = (self.width - text_w) // 2
            text_y = (self.height - text_h) // 2

            # 텍스트 배경 (반투명 블랙)
            padding = 40
            draw.rounded_rectangle(
                [
                    text_x - padding,
                    text_y - padding,
                    text_x + text_w + padding,
                    text_y + text_h + padding
                ],
                radius=20,
                fill=(0, 0, 0, 200)
            )

            # 그림자
            shadow_offset = 4
            draw.multiline_text(
                (text_x + shadow_offset, text_y + shadow_offset),
                wrapped,
                font=font_main,
                fill=(10, 10, 20),
                align='center'
            )

            # 메인 텍스트 (화이트 or 골드)
            main_color = (255, 255, 255) if video_type == "INFO" else (255, 215, 0)

            draw.multiline_text(
                (text_x, text_y),
                wrapped,
                font=font_main,
                fill=main_color,
                align='center'
            )

            # 6. 하단 채널명
            try:
                font_channel = ImageFont.truetype(self.font_bold, 50)
            except:
                font_channel = ImageFont.load_default()

            channel_text = "AI INSIDER"
            draw.text(
                (self.width // 2, self.height - 150),
                channel_text,
                font=font_channel,
                fill=(76, 209, 196),
                anchor='mm'
            )

            # 7. 저장
            output_path = self.output_dir / f"thumb_{video_type}_{bno}.jpg"
            img.save(output_path, quality=95)

            # 배경 이미지 정리
            if bg_image_path and bg_image_path.exists():
                bg_image_path.unlink(missing_ok=True)

            logger.info(f"✅ 썸네일 V2 생성 완료: {output_path}")
            return str(output_path)

        except Exception as e:
            logger.error(f"❌ 썸네일 V2 생성 실패: {e}", exc_info=True)
            return ""

    def _crop_to_ratio(self, img: Image.Image, target_w: int, target_h: int) -> Image.Image:
        """9:16 비율로 center crop"""
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

    def _create_dark_gradient_bg(self, video_type: str) -> Image.Image:
        """
        Dark Gradient 배경 (랜덤 색상 금지)
        """
        import numpy as np

        gradient = np.zeros((self.height, self.width, 3), dtype=np.uint8)

        if video_type == 'AGRO':
            top = (30, 15, 50)    # 다크 퍼플
            bot = (10, 5, 25)      # 딥 블랙
        else:
            top = (15, 30, 60)    # 다크 블루
            bot = (5, 10, 25)      # 딥 블랙

        for y in range(self.height):
            ratio = y / self.height
            gradient[y, :] = (
                int(top[0] + (bot[0] - top[0]) * ratio),
                int(top[1] + (bot[1] - top[1]) * ratio),
                int(top[2] + (bot[2] - top[2]) * ratio),
            )

        return Image.fromarray(gradient)

    def _wrap_text(self, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> str:
        """텍스트 자동 줄바꿈"""
        words = text.split()
        lines = []
        current_line = ""

        for word in words:
            test_line = current_line + word + " "
            bbox = font.getbbox(test_line)
            width = bbox[2] - bbox[0]

            if width <= max_width:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line.strip())
                current_line = word + " "

        if current_line:
            lines.append(current_line.strip())

        return "\n".join(lines)


# 하위 호환 함수
def generate_thumbnail_v2(
        title: str,
        content: str,
        video_type: str,
        bno: int = 0
) -> str:
    """하위 호환용"""
    generator = ThumbnailGeneratorV2()
    return generator.create_thumbnail(title, content, video_type, bno)
