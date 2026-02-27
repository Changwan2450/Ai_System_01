"""
썸네일 자동 생성 모듈
- Persona 아바타 합성
- 텍스트 오버레이
- 눈길 가는 디자인
"""
import logging
from typing import Dict, Any, Optional, Tuple
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import requests
from io import BytesIO

from config import BASE_DIR, OUTPUT_DIR, LOG_FORMAT, LOG_LEVEL

# ===============================
# 로깅 설정
# ===============================
logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)


# ===============================
# 썸네일 생성기
# ===============================
class ThumbnailGenerator:
    """AI 쇼츠 썸네일 자동 생성"""

    def __init__(self):
        self.width = 1080
        self.height = 1920
        self.output_dir = OUTPUT_DIR

        # 폰트 경로
        self.font_bold = "/Users/changwan/Library/Fonts/Pretendard-Bold.otf"
        self.font_regular = "/Users/changwan/Library/Fonts/Pretendard-Regular.otf"

    def create_thumbnail(
            self,
            title: str,
            video_type: str,
            persona_avatar_url: Optional[str] = None,
            bno: int = 0
    ) -> str:
        """
        썸네일 생성

        Args:
            title: 영상 제목
            video_type: AGRO 또는 INFO
            persona_avatar_url: Persona 아바타 이미지 URL
            bno: 게시글 번호

        Returns:
            썸네일 파일 경로
        """
        try:
            # 1. 배경 생성
            if video_type == "AGRO":
                bg_color = (255, 50, 50)  # 빨강
                accent_color = (255, 255, 0)  # 노랑
                emoji = "🔥"
            else:
                bg_color = (30, 100, 200)  # 파랑
                accent_color = (255, 255, 255)  # 하양
                emoji = "🧠"

            img = Image.new('RGB', (self.width, self.height), bg_color)
            draw = ImageDraw.Draw(img)

            # 2. 그라데이션 효과 (상단 어둡게)
            for y in range(600):
                alpha = int(255 * (y / 600))
                overlay = Image.new('RGB', (self.width, 1), (0, 0, 0))
                overlay.putalpha(alpha)
                img.paste(overlay, (0, y), overlay)

            # 3. Persona 아바타 (있으면)
            if persona_avatar_url:
                try:
                    response = requests.get(persona_avatar_url, timeout=5)
                    avatar = Image.open(BytesIO(response.content))
                    avatar = avatar.resize((300, 300))

                    # 원형 마스크
                    mask = Image.new('L', (300, 300), 0)
                    mask_draw = ImageDraw.Draw(mask)
                    mask_draw.ellipse((0, 0, 300, 300), fill=255)

                    # 붙이기
                    img.paste(avatar, (390, 200), mask)
                except Exception as e:
                    logger.warning(f"⚠️ 아바타 로드 실패: {e}")

            # 4. 타이틀 텍스트
            try:
                font_title = ImageFont.truetype(self.font_bold, 90)
            except:
                font_title = ImageFont.load_default()

            # 제목 줄바꿈 처리
            wrapped_title = self._wrap_text(title, font_title, self.width - 100)

            # 텍스트 박스 배경
            bbox = draw.multiline_textbbox((0, 0), wrapped_title, font=font_title, align='center')
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]

            text_x = (self.width - text_width) // 2
            text_y = 700

            # 반투명 박스
            draw.rectangle(
                [text_x - 40, text_y - 40, text_x + text_width + 40, text_y + text_height + 40],
                fill=(0, 0, 0, 180)
            )

            # 텍스트 그리기
            draw.multiline_text(
                (text_x, text_y),
                wrapped_title,
                font=font_title,
                fill=accent_color,
                align='center'
            )

            # 5. 이모지/뱃지
            try:
                font_emoji = ImageFont.truetype(self.font_bold, 120)
            except:
                font_emoji = ImageFont.load_default()

            draw.text((50, 50), emoji, font=font_emoji, fill=accent_color)

            # 6. 타입 뱃지
            badge_text = "어그로 렉카" if video_type == "AGRO" else "심층 해설"
            try:
                font_badge = ImageFont.truetype(self.font_bold, 50)
            except:
                font_badge = ImageFont.load_default()

            badge_bbox = draw.textbbox((0, 0), badge_text, font=font_badge)
            badge_width = badge_bbox[2] - badge_bbox[0]

            badge_x = self.width - badge_width - 80
            badge_y = 60

            draw.rounded_rectangle(
                [badge_x - 20, badge_y - 10, badge_x + badge_width + 20, badge_y + 60],
                radius=15,
                fill=accent_color
            )

            draw.text((badge_x, badge_y), badge_text, font=font_badge, fill=bg_color)

            # 7. 저장
            output_path = self.output_dir / f"thumb_{video_type}_{bno}.jpg"
            img.save(output_path, quality=95)

            logger.info(f"✅ 썸네일 생성 완료: {output_path}")
            return str(output_path)

        except Exception as e:
            logger.error(f"❌ 썸네일 생성 실패: {e}", exc_info=True)
            return ""

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


# ===============================
# 하위 호환 함수
# ===============================
def generate_thumbnail(
        title: str,
        video_type: str,
        persona_avatar_url: Optional[str] = None,
        bno: int = 0
) -> str:
    """하위 호환용"""
    generator = ThumbnailGenerator()
    return generator.create_thumbnail(title, video_type, persona_avatar_url, bno)