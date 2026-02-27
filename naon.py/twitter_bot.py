"""
트위터 자동 포스팅 봇 (비동기 버전)
- Tweepy API v2 사용
- 비동기 처리로 대량 트윗 지원
"""
import asyncio
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path
from dataclasses import dataclass

import tweepy
from tweepy.errors import TweepyException

# ===============================
# 설정
# ===============================
BASE_DIR: Path = Path(__file__).resolve().parent

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(BASE_DIR / "twitter_bot.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


# ===============================
# 인증 정보 데이터 클래스
# ===============================
@dataclass
class TwitterCredentials:
    """트위터 API 인증 정보"""
    api_key: str = "uPncHifkbKZEr2VKpHjgbgTeW"
    api_key_secret: str = "pRgWJDz72Y9VdUOF0a7RSoVMSdbdzv7Ee5a5qgwy2xSY12BAJU"
    access_token: str = "2020146294-AQ8hicIR8o3eELejEf7Kx3XJbyxyVj"
    access_token_secret: str = "Mcv2zR5ND2r54yMdg445NxMkXvDSznAgMxa5oIW835Bev"


# ===============================
# 트위터 봇 클래스
# ===============================
class TwitterBot:
    """비동기 트위터 봇 클래스"""

    def __init__(self, credentials: TwitterCredentials):
        """
        Args:
            credentials: 트위터 API 인증 정보
        """
        self.credentials = credentials
        self.client: Optional[tweepy.Client] = None
        self.api: Optional[tweepy.API] = None

    def authenticate(self) -> bool:
        """
        트위터 API 인증

        Returns:
            인증 성공 여부
        """
        try:
            # V1.1 인증 (미디어 업로드용)
            auth = tweepy.OAuth1UserHandler(
                self.credentials.api_key,
                self.credentials.api_key_secret,
                self.credentials.access_token,
                self.credentials.access_token_secret
            )
            self.api = tweepy.API(auth)

            # V2 클라이언트 (트윗 작성용)
            self.client = tweepy.Client(
                consumer_key=self.credentials.api_key,
                consumer_secret=self.credentials.api_key_secret,
                access_token=self.credentials.access_token,
                access_token_secret=self.credentials.access_token_secret
            )

            # 인증 테스트
            self.client.get_me()
            logger.info("✅ 트위터 인증 성공")
            return True

        except TweepyException as e:
            logger.error(f"❌ 트위터 인증 실패: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ 예상치 못한 오류: {e}", exc_info=True)
            return False

    async def post_tweet(self, text: str, media_path: Optional[str] = None) -> Dict[str, Any]:
        """
        비동기 트윗 포스팅

        Args:
            text: 트윗 내용
            media_path: 첨부 미디어 파일 경로 (선택)

        Returns:
            결과 딕셔너리
        """
        result: Dict[str, Any] = {
            "success": False,
            "tweet_id": None,
            "error": None
        }

        if not self.client:
            result["error"] = "인증되지 않음"
            return result

        try:
            # 미디어 업로드 (동기 작업이므로 executor에서 실행)
            media_ids: Optional[List[str]] = None
            if media_path and Path(media_path).exists():
                loop = asyncio.get_event_loop()
                media = await loop.run_in_executor(
                    None,
                    self.api.media_upload,
                    media_path
                )
                media_ids = [media.media_id_string]
                logger.info(f"📎 미디어 업로드 완료: {media_path}")

            # 트윗 작성 (동기 작업이므로 executor에서 실행)
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.client.create_tweet(text=text, media_ids=media_ids)
            )

            tweet_id: str = response.data['id']
            result |= {
                "success": True,
                "tweet_id": tweet_id
            }

            logger.info(f"✅ 트윗 발사 성공! ID: {tweet_id}")

        except TweepyException as e:
            error_msg: str = f"트윗 실패: {str(e)}"
            logger.error(f"❌ {error_msg}")
            result["error"] = error_msg

        except Exception as e:
            error_msg: str = f"예상치 못한 오류: {str(e)}"
            logger.error(f"❌ {error_msg}", exc_info=True)
            result["error"] = error_msg

        return result

    async def post_multiple_tweets(
            self,
            tweets: List[Dict[str, str]],
            delay: float = 5.0
    ) -> List[Dict[str, Any]]:
        """
        여러 트윗을 순차적으로 포스팅

        Args:
            tweets: [{"text": "...", "media_path": "..."}] 형식의 리스트
            delay: 트윗 간 대기 시간 (초)

        Returns:
            각 트윗의 결과 리스트
        """
        results: List[Dict[str, Any]] = []

        for idx, tweet_data in enumerate(tweets, 1):
            logger.info(f"🚀 트윗 {idx}/{len(tweets)} 발사 중...")

            result = await self.post_tweet(
                text=tweet_data.get("text", ""),
                media_path=tweet_data.get("media_path")
            )
            results.append(result)

            if idx < len(tweets):
                logger.info(f"⏳ {delay}초 대기...")
                await asyncio.sleep(delay)

        return results


# ===============================
# 비동기 실행 함수
# ===============================
async def main() -> None:
    """메인 실행 함수"""
    credentials = TwitterCredentials()
    bot = TwitterBot(credentials)

    if not bot.authenticate():
        logger.error("인증 실패로 종료")
        return

    # 단일 트윗 테스트
    result = await bot.post_tweet("🤖 비동기 트위터 봇 테스트 발사!")

    if result["success"]:
        print(f"✅ 트윗 성공! ID: {result['tweet_id']}")
    else:
        print(f"❌ 트윗 실패: {result['error']}")


if __name__ == "__main__":
    asyncio.run(main())
