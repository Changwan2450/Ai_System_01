"""
비동기 웹 크롤러
- aiohttp 기반 비동기 HTTP 요청
- BeautifulSoup HTML 파싱
"""
import asyncio
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup
from aiohttp import ClientTimeout, ClientError

# ===============================
# 설정
# ===============================
BASE_DIR: Path = Path(__file__).resolve().parent

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(BASE_DIR / "crawler.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 기본 설정
DEFAULT_TIMEOUT: int = 10
DEFAULT_MAX_TOPICS: int = 5
BOARD_URL: str = "http://localhost:9090/board/list"


# ===============================
# 크롤러 클래스
# ===============================
class AsyncBoardCrawler:
    """비동기 게시판 크롤러"""

    def __init__(self, base_url: str = BOARD_URL, timeout: int = DEFAULT_TIMEOUT):
        """
        Args:
            base_url: 크롤링할 게시판 URL
            timeout: HTTP 요청 타임아웃 (초)
        """
        self.base_url = base_url
        self.timeout = ClientTimeout(total=timeout)
        self.headers: Dict[str, str] = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }

    async def fetch_page(self, session: aiohttp.ClientSession) -> Optional[str]:
        """
        비동기로 페이지 HTML 가져오기

        Args:
            session: aiohttp 세션

        Returns:
            HTML 텍스트 (실패 시 None)
        """
        try:
            async with session.get(
                    self.base_url,
                    headers=self.headers,
                    timeout=self.timeout
            ) as response:
                response.raise_for_status()
                html: str = await response.text()
                logger.info(f"✅ 페이지 가져오기 성공: {self.base_url}")
                return html

        except asyncio.TimeoutError:
            logger.error(f"⏰ 타임아웃: {self.base_url}")
        except ClientError as e:
            logger.error(f"❌ HTTP 오류: {e}")
        except Exception as e:
            logger.error(f"❌ 예상치 못한 오류: {e}", exc_info=True)

        return None

    def parse_topics(self, html: str, max_topics: int = DEFAULT_MAX_TOPICS) -> List[Dict[str, str]]:
        """
        HTML에서 핫토픽 파싱

        Args:
            html: HTML 텍스트
            max_topics: 최대 추출 개수

        Returns:
            [{"title": "...", "content": "..."}] 형식의 리스트
        """
        topics: List[Dict[str, str]] = []

        try:
            soup = BeautifulSoup(html, 'html.parser')
            items = soup.select('table tr')[1:max_topics + 1]

            for item in items:
                tag = item.select_one('.title-link')
                if tag:
                    title: str = tag.text.strip()
                    content: str = f"오늘의 게시판 핫이슈, {title} 소식입니다."

                    topics.append({
                        "title": title,
                        "content": content
                    })

            logger.info(f"✅ 파싱 완료: {len(topics)}개 주제 추출")

        except Exception as e:
            logger.error(f"❌ 파싱 오류: {e}", exc_info=True)

        return topics

    async def get_hot_topics(self, max_topics: int = DEFAULT_MAX_TOPICS) -> List[Dict[str, str]]:
        """
        비동기로 핫토픽 가져오기 (메인 인터페이스)

        Args:
            max_topics: 최대 추출 개수

        Returns:
            토픽 리스트
        """
        async with aiohttp.ClientSession() as session:
            html = await self.fetch_page(session)

            if html is None:
                logger.warning("⚠️ 서버 연결 실패 - 빈 리스트 반환")
                return []

            return self.parse_topics(html, max_topics)


# ===============================
# 하위 호환 함수
# ===============================
async def get_hot_topics() -> List[Dict[str, str]]:
    """
    비동기 핫토픽 가져오기 (하위 호환용)

    Returns:
        토픽 리스트
    """
    crawler = AsyncBoardCrawler()
    return await crawler.get_hot_topics()


# ===============================
# CLI 실행
# ===============================
async def main() -> None:
    """메인 실행 함수"""
    logger.info("🚀 크롤러 시작")

    topics = await get_hot_topics()

    if topics:
        print(f"\n✅ 총 {len(topics)}개 토픽 수집 완료:\n")
        for idx, topic in enumerate(topics, 1):
            print(f"{idx}. {topic['title']}")
    else:
        print("❌ 수집 실패 (서버가 켜져 있는지 확인하세요)")


if __name__ == "__main__":
    asyncio.run(main())
