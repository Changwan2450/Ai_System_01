#!/usr/bin/env python3
"""
PR-PHASE2: 대본 생성 테스트 스크립트
DB나 렌더링 없이 대본만 생성하여 검증
"""
import json
import sys
from typing import Dict, Any

# 대본 생성 함수만 import
from shorts_generator import generate_script_with_openai


def test_script_generation(title: str, content: str, video_type: str = "AGRO") -> None:
    """대본 생성 테스트 (DB 없이)"""
    print(f"\n{'='*60}")
    print(f"[PR-PHASE2] 떡밥 대본 생성 테스트")
    print(f"{'='*60}")
    print(f"제목: {title}")
    print(f"타입: {video_type}")
    print(f"내용 미리보기: {content[:100]}...")
    print(f"{'='*60}\n")

    # 가상 target_data 생성
    target_data: Dict[str, Any] = {
        "bno": 9999,
        "title": title,
        "content": content,
        "video_type": video_type,
        "p_id": "tech_insider",
        "quality_score": 7.5
    }

    # 대본 생성
    print("🤖 OpenAI 대본 생성 중...\n")
    script = generate_script_with_openai(target_data, video_type)

    if script:
        print("✅ 대본 생성 성공!\n")
        print(f"{'='*60}")
        print("생성된 대본 (JSON)")
        print(f"{'='*60}")
        print(json.dumps(script, ensure_ascii=False, indent=2))
        print(f"{'='*60}\n")

        # 필드별 분석
        print("📊 필드별 분석:\n")

        hook = script.get("hook", "")
        core = script.get("core_summary", "")
        controversy = script.get("controversy_point", "")
        trigger = script.get("comment_trigger", "")

        print(f"1️⃣  hook (감탄형/충격형):")
        print(f"   길이: {len(hook)}자")
        print(f"   내용: {hook}")
        print(f"   ✓ 감탄형/충격형: {'✅' if any(x in hook for x in ['와', '어', '그니까', '솔직히']) else '❌'}")
        print()

        print(f"2️⃣  core_summary (핵심 요약):")
        print(f"   길이: {len(core)}자")
        print(f"   내용: {core}")
        print(f"   ✓ 적정 길이 (40-60자): {'✅' if 40 <= len(core) <= 70 else '❌'}")
        print()

        print(f"3️⃣  controversy_point (논쟁 유도):")
        print(f"   길이: {len(controversy)}자")
        print(f"   내용: {controversy}")
        print(f"   ✓ 적정 길이 (30-50자): {'✅' if 30 <= len(controversy) <= 60 else '❌'}")
        print()

        print(f"4️⃣  comment_trigger (질문형):")
        print(f"   길이: {len(trigger)}자")
        print(f"   내용: {trigger}")
        print(f"   ✓ 질문형: {'✅' if '?' in trigger or any(x in trigger for x in ['어떻게', '어떠', '어때']) else '❌'}")
        print()

        # 금지 표현 검증
        print("🚫 금지 표현 검증:\n")
        banned = ["ㄹㅇ", "실화냐", "대박", "충격", "헐"]
        all_text = " ".join(script.values())
        found_banned = [b for b in banned if b in all_text]

        if found_banned:
            print(f"   ❌ 금지 표현 발견: {', '.join(found_banned)}")
        else:
            print(f"   ✅ 금지 표현 없음")

        # 총 예상 시간
        total_chars = sum(len(str(v)) for v in script.values())
        estimated_seconds = total_chars / 7  # 1초당 약 7자 (TTS 1.25x 기준)
        print(f"\n⏱️  예상 재생 시간: {estimated_seconds:.1f}초 (목표: 40-60초)")

        if 40 <= estimated_seconds <= 65:
            print("   ✅ 적정 길이")
        else:
            print(f"   ⚠️  {'너무 짧음' if estimated_seconds < 40 else '너무 김'}")

    else:
        print("❌ 대본 생성 실패")
        sys.exit(1)


def main():
    """메인 실행"""
    print("\n" + "="*60)
    print("PR-PHASE2: 떡밥 대본 생성 테스트")
    print("="*60)

    # 테스트 케이스 선택
    if len(sys.argv) > 1:
        test_case = int(sys.argv[1])
    else:
        print("\n사용법:")
        print("  python3 test_script_generator.py [테스트번호]")
        print("\n테스트 케이스:")
        print("  1: OpenAI GPT-5 출시 루머")
        print("  2: 구글 Gemini Pro 무료화")
        print("  3: 국내 AI 스타트업 대규모 투자")
        print()
        test_case = int(input("테스트 번호 입력 (1-3): "))

    # 테스트 케이스
    test_cases = {
        1: {
            "title": "OpenAI GPT-5 출시 루머 확산, 개발자 커뮤니티 들썩",
            "content": """
실리콘밸리 내부자들 사이에서 OpenAI가 GPT-5를 조만간 출시할 것이라는 루머가 확산되고 있다.
한 익명의 관계자는 "이번 모델은 기존 GPT-4보다 추론 능력이 10배 향상됐다"고 주장했다.
하지만 일부 개발자들은 "또 과대광고 아니냐"며 회의적인 반응을 보이고 있다.
특히 가격 정책에 대한 우려가 크다. 무료 티어가 유지될지, 아니면 유료 전환될지 불확실하다.
Reddit과 Hacker News에서는 찬반 논쟁이 뜨겁다.
            """,
            "video_type": "AGRO"
        },
        2: {
            "title": "구글 Gemini Pro, 무료 API 제공... 개발자들 환호",
            "content": """
구글이 Gemini Pro 모델을 무료 API로 제공하기 시작했다.
기존 OpenAI와 달리 월 100만 토큰까지 무료로 사용 가능하다.
개발자들은 "드디어 GPT 독점 깨졌다"며 환영하고 있다.
하지만 성능에 대한 의견은 엇갈린다. 일부는 "GPT-4만 못하다"고 평가하는 반면,
다른 이들은 "무료인데 이 정도면 충분하다"고 반박한다.
특히 한국어 성능에 대한 평가가 엇갈리고 있다.
            """,
            "video_type": "INFO"
        },
        3: {
            "title": "국내 AI 스타트업 3곳, 총 500억 투자 유치",
            "content": """
국내 AI 스타트업 3곳이 동시에 대규모 투자를 받았다.
업비트AI는 200억, 네이버AI랩은 150억, 카카오브레인은 150억을 유치했다.
투자자들은 "한국 AI 시장의 폭발적 성장 가능성"을 언급했다.
하지만 업계 일각에서는 "버블 아니냐"는 우려도 나온다.
실제로 수익 모델이 불확실한 상태에서 과도한 밸류에이션이라는 지적이 있다.
개발자 커뮤니티에서는 "이제 국내에서도 AI 일자리 늘어날까?"라는 기대감이 크다.
            """,
            "video_type": "AGRO"
        }
    }

    if test_case not in test_cases:
        print(f"❌ 잘못된 테스트 번호: {test_case}")
        sys.exit(1)

    case = test_cases[test_case]
    test_script_generation(
        title=case["title"],
        content=case["content"],
        video_type=case["video_type"]
    )


if __name__ == "__main__":
    main()
