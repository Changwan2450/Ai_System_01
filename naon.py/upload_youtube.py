"""
유튜브 자동 업로드 모듈
- Google API OAuth 2.0 인증 (client_secrets.json 사용)
- config.py를 통한 경로 및 로깅 설정 통합
"""
import os
import logging
from typing import Dict, Any, Optional
from pathlib import Path

import google_auth_oauthlib.flow
import googleapiclient.discovery
import googleapiclient.errors
from googleapiclient.http import MediaFileUpload

# 형의 프로젝트 공통 설정 로드
from config import (
    BASE_DIR, OUTPUT_DIR,
    YOUTUBE_CLIENT_SECRETS_PATH,
    LOG_FORMAT, LOG_LEVEL
)

# ===============================
# 로깅 설정 (다른 모듈과 통일)
# ===============================
logging.basicConfig(
    level=LOG_LEVEL,
    format=LOG_FORMAT,
    handlers=[
        logging.FileHandler(BASE_DIR / "upload_youtube.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 로컬 테스트 시 HTTPS 체크 우회 (맥 미니 서버 환경)
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

# ===============================
# 인증 파일 경로 체크
# ===============================
CLIENT_SECRETS_FILE: Path = Path(YOUTUBE_CLIENT_SECRETS_PATH)


# ===============================
# 유튜브 업로드 핵심 함수
# ===============================
def upload_video(
        video_file: str,
        title: str,
        description: str,
        tags: Optional[list[str]] = None,
        category_id: str = "22",  # 22: People & Blogs
        privacy_status: str = "public"
) -> Dict[str, Any]:
    """
    유튜브에 영상 업로드 및 결과 반환
    """
    result: Dict[str, Any] = {
        "success": False,
        "video_id": None,
        "error": None
    }

    video_path = Path(video_file)

    # 1. 사전 검증
    if not video_path.exists():
        msg = f"영상 파일 없음: {video_file}"
        logger.error(f"❌ {msg}")
        result["error"] = msg
        return result

    if not CLIENT_SECRETS_FILE.exists():
        msg = f"인증 파일(JSON) 없음: {CLIENT_SECRETS_FILE}"
        logger.error(f"❌ {msg}")
        result["error"] = msg
        return result

    try:
        # 2. OAuth 2.0 인증 절차
        # 최초 실행 시 브라우저가 열리며 로그인이 필요함 (iPad 원격 시 맥 미니 본체에서 확인 필요)
        scopes = ["https://www.googleapis.com/auth/youtube.upload"]
        flow = google_auth_oauthlib.flow.InstalledAppFlow.from_client_secrets_file(
            str(CLIENT_SECRETS_FILE), scopes
        )

        # port=0으로 두면 남는 포트 자동 할당
        credentials = flow.run_local_server(port=0, authorization_prompt_message="구글 로그인 해주세요 형")

        # 3. YouTube API 클라이언트 생성
        youtube = googleapiclient.discovery.build(
            "youtube", "v3", credentials=credentials
        )

        # 4. 메타데이터 설정
        if tags is None:
            tags = ["AI", "Shorts", "개발자형", "자동화"]

        body = {
            "snippet": {
                "title": title,
                "description": description,
                "tags": tags,
                "categoryId": category_id
            },
            "status": {
                "privacyStatus": privacy_status,
                "selfDeclaredMadeForKids": False
            }
        }

        # 5. 미디어 업로드 (resumable=True로 대용량 대응)
        media = MediaFileUpload(
            str(video_path),
            chunksize=-1,
            resumable=True
        )

        insert_request = youtube.videos().insert(
            part="snippet,status",
            body=body,
            media_body=media
        )

        logger.info(f"🚀 유튜브 업로드 시작: {video_path.name}")
        response = insert_request.execute()

        video_id = response.get('id')
        result.update({"success": True, "video_id": video_id})

        logger.info(f"✅ 업로드 완료! 영상 ID: {video_id}")
        logger.info(f"🔗 주소: https://youtu.be/{video_id}")

    except googleapiclient.errors.HttpError as e:
        error_msg = f"YouTube API HTTP 오류: {e}"
        logger.error(f"❌ {error_msg}")
        result["error"] = error_msg
    except Exception as e:
        error_msg = f"업로드 중 예상치 못한 오류: {str(e)}"
        logger.error(f"❌ {error_msg}", exc_info=True)
        result["error"] = error_msg

    return result


# ===============================
# 단독 실행 테스트 (CLI)
# ===============================
def main():
    """테스트용 실행 로직"""
    # output 폴더에 있는 가장 최근 mp4 하나 골라서 테스트해볼 때 사용
    test_video = str(OUTPUT_DIR / "shorts_test.mp4")

    if not Path(test_video).exists():
        print(f"⚠️ 테스트할 영상이 {test_video}에 없어 형.")
        return

    res = upload_video(
        video_file=test_video,
        title="AI 쇼츠 자동 생성 테스트",
        description="이 영상은 맥 미니 서버에서 자동으로 생성되고 업로드되었습니다.",
        tags=["Python", "Automation", "Shorts"]
    )

    if res["success"]:
        print(f"🔥 성공! ID: {res['video_id']}")
    else:
        print(f"💀 실패: {res['error']}")


if __name__ == "__main__":
    main()
