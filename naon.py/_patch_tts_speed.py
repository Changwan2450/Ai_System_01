"""
TTS 속도 제어 개선 (ffmpeg atempo)
shorts_generator.py에 통합할 함수들
"""
import subprocess
import logging
from pathlib import Path
from typing import Optional
import asyncio

logger = logging.getLogger(__name__)

TEMP_DIR = Path(__file__).parent / "temp"


def apply_speed_with_ffmpeg(input_path: Path, output_path: Path, speed: float = 1.35) -> bool:
    """
    ffmpeg atempo 필터로 TTS 속도 강제 조정
    - 2.0 초과 시 atempo 체인 방식 사용
    - 0.2초 무음 패딩 추가
    """
    try:
        # atempo는 0.5 ~ 2.0 범위만 지원 → 체인 필요
        filters = []
        remaining_speed = speed

        while remaining_speed > 2.0:
            filters.append("atempo=2.0")
            remaining_speed /= 2.0

        while remaining_speed < 0.5:
            filters.append("atempo=0.5")
            remaining_speed /= 0.5

        if remaining_speed != 1.0:
            filters.append(f"atempo={remaining_speed:.3f}")

        # 0.2초 무음 패딩 추가
        filter_chain = ",".join(filters) + ",apad=pad_dur=0.2"

        cmd = [
            'ffmpeg', '-i', str(input_path),
            '-af', filter_chain,
            '-y', str(output_path)
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,
            text=True
        )

        if result.returncode == 0 and output_path.exists():
            logger.info(f"속도 조정 완료: {speed}x (atempo 체인: {len(filters)}단계)")
            return True
        else:
            logger.warning(f"ffmpeg 속도 조정 실패: {result.stderr[:200]}")
            return False

    except Exception as e:
        logger.error(f"속도 조정 예외: {e}")
        return False


async def generate_audio_with_speed_control(
        text: str,
        voice: str,
        base_speed: str,
        output_path: Path,
        target_speed: float = 1.35
) -> bool:
    """
    TTS 생성 + ffmpeg 속도 강제 조정
    - base_speed는 edge-tts 내장 속도
    - target_speed는 ffmpeg로 추가 조정
    """
    temp_raw = output_path.parent / f"raw_{output_path.name}"

    try:
        # 1단계: edge-tts 생성 (재시도 3회)
        MAX_RETRIES = 3
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logger.info(f"edge-tts 시도 {attempt}/{MAX_RETRIES}")
                import edge_tts
                communicate = edge_tts.Communicate(text, voice, rate=base_speed)
                await communicate.save(str(temp_raw))
                logger.info(f"edge-tts 성공 (시도 {attempt})")
                break
            except Exception as e:
                if attempt == MAX_RETRIES:
                    logger.warning(f"edge-tts 최종 실패 → gTTS 폴백")
                    from gtts import gTTS
                    tts = gTTS(text=text, lang='ko')
                    tts.save(str(temp_raw))
                    break
                else:
                    delay = 2.0 * (2 ** (attempt - 1))
                    logger.warning(f"edge-tts 실패 (시도 {attempt}): {e}, {delay:.1f}초 후 재시도")
                    await asyncio.sleep(delay)

        if not temp_raw.exists():
            logger.error("TTS 생성 실패")
            return False

        # 2단계: ffmpeg 속도 조정
        success = apply_speed_with_ffmpeg(temp_raw, output_path, target_speed)

        # 정리
        temp_raw.unlink(missing_ok=True)

        return success

    except Exception as e:
        logger.error(f"TTS + 속도 조정 실패: {e}", exc_info=True)
        temp_raw.unlink(missing_ok=True)
        return False


def generate_audio_with_speed_sync(
        text: str,
        voice: str,
        base_speed: str,
        output_path: Path,
        target_speed: float = 1.35
) -> bool:
    """동기 래퍼"""
    return asyncio.run(
        generate_audio_with_speed_control(text, voice, base_speed, output_path, target_speed)
    )


def split_text_by_words(text: str, words_per_chunk: int = 12) -> list:
    """
    문장을 10~15단어 단위로 분리
    """
    words = text.split()
    chunks = []

    for i in range(0, len(words), words_per_chunk):
        chunk = " ".join(words[i:i + words_per_chunk])
        chunks.append(chunk)

    return chunks
