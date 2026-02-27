# 영상 품질 개선 통합 가이드

## 적용 순서

### 1. BGM 볼륨 조정 (30%)

**shorts_generator.py line 66**
```python
# 변경 전
BGM_VOLUME: float = 0.12  # BGM 볼륨 (12%)

# 변경 후
BGM_VOLUME: float = 0.30  # BGM 볼륨 (30%)
```

---

### 2. TTS 속도 제어 함수 교체

**shorts_generator.py에 추가 (line 876 이후)**

`_patch_tts_speed.py`의 다음 함수들을 복사:
- `apply_speed_with_ffmpeg()`
- `generate_audio_with_speed_control()`
- `generate_audio_with_speed_sync()`
- `split_text_by_words()`

**기존 함수 교체:**
```python
# line 872-874 제거 또는 주석
# def generate_audio_sync(text: str, voice: str, speed: str, output_path: Path) -> bool:
#     return asyncio.run(generate_audio_async(text, voice, speed, output_path))

# 새 함수로 교체
def generate_audio_sync(text: str, voice: str, speed: str, output_path: Path) -> bool:
    # split_text_by_words()로 10~15단어 분리 (선택)
    return generate_audio_with_speed_sync(
        text, voice, speed, output_path, target_speed=1.35
    )
```

---

### 3. 이미지 선택 함수 교체

**shorts_generator.py의 `fetch_background_images()` 함수 (line 233-278) 교체**

`_patch_image_render.py`의 다음 함수들을 복사:
- `extract_nouns_from_text()`
- `is_extreme_solid_color()`
- `fetch_keyword_based_images()`
- `_crop_to_shorts()` (이미 존재하므로 유지)

**호출 부분 수정:**
```python
# line 968 변경 전
bg_images = fetch_background_images(title, bno, count=min(len(parts), 3))

# 변경 후
keywords = extract_nouns_from_text(title + " " + content[:200])
bg_images = fetch_keyword_based_images(keywords, bno, count=len(parts), video_type=video_type)
```

---

### 4. Ken Burns + 텍스트 오버레이 개선

**shorts_generator.py의 본문 렌더링 부분 (line 984-1055) 교체**

`_patch_image_render.py`의 다음 함수들을 복사:
- `create_dynamic_ken_burns_clip()`
- `create_dynamic_text_overlay()`

**line 992-994 교체:**
```python
# 변경 전
kb_clip = _create_ken_burns_clip(
    bg_images[img_idx], part_dur, direction=kb_dir
).set_start(body_time)

# 변경 후
kb_clip = create_dynamic_ken_burns_clip(
    bg_images[img_idx], part_dur, part_index=idx
).set_start(body_time)
```

**line 1015-1053 (자막 부분) 교체:**
```python
# 변경 전: 그림자 + 본체 수동 생성 코드 (38줄)

# 변경 후
# 자막 (다이나믹 위치)
is_highlight = (idx == 0)
text_clips = create_dynamic_text_overlay(
    part["text"],
    part_dur,
    part_index=idx,
    is_highlight=is_highlight
)

for tc in text_clips:
    tc = tc.set_start(body_time)
    body_sub_clips.append(tc)
```

---

### 5. 썸네일 생성 V2 적용

**방법 1: 파일 교체 (권장)**
```bash
mv thumbnail_generator.py thumbnail_generator_old.py
mv thumbnail_generator_v2.py thumbnail_generator.py
```

**방법 2: import 수정**
```python
# shorts_generator.py line 39 변경
# from thumbnail_generator import ThumbnailGenerator

from thumbnail_generator_v2 import ThumbnailGeneratorV2 as ThumbnailGenerator
```

**호출 시 content 파라미터 추가:**
```python
# 썸네일 생성 부분
thumbnail_path = thumbnail_gen.create_thumbnail(
    title=title,
    content=content,  # 추가
    video_type=video_type,
    bno=bno
)
```

---

## 테스트

```bash
# Python 가상환경 활성화
cd /Users/changwan/dev/gemini-workspace/AI_SYSTEM/naon.py
source .venv/bin/activate

# 영상 생성 테스트
python -c "
from shorts_generator import generate_shorts
result = generate_shorts(bno=<TEST_BNO>)
print(f'결과: {result}')
"
```

---

## 검증 포인트

### TTS 속도
- `ffmpeg ... -af "atempo=1.35,apad=pad_dur=0.2"` 로그 확인
- 영상 전체 길이가 30~20% 단축되었는지 확인

### 이미지 선택
- 로그에서 `이미지 검색: <키워드>` 확인
- `극단적 원색 이미지 제외` 로그 확인
- 배경 이미지가 주제와 관련 있는지 육안 확인

### 영상 컷 편집
- 각 파트별 다른 Ken Burns 효과 (zoom_in/zoom_out/pan_left/pan_right)
- 텍스트 위치가 파트별로 다른지 확인 (750/850/950/800)

### 썸네일
- 6~9단어 훅 문장 추출 확인
- 관련 이미지 사용 여부 확인
- 극단적 원색 배경(빨강/파랑) 제거 확인

### BGM
- 오디오 믹싱 로그에서 `BGM 적용: ..., 볼륨=0.3` 확인
- 영상에서 BGM이 TTS를 방해하지 않는지 청취 확인

---

## 롤백

문제 발생 시:
```bash
# 백업 복원
mv thumbnail_generator_old.py thumbnail_generator.py

# 또는 git reset (git 사용 시)
git checkout shorts_generator.py thumbnail_generator.py
```

---

## 추가 최적화 옵션

### 텍스트 분리 (10~15단어)
```python
# render_video_with_persona() 내부, line 910 이후
from _patch_tts_speed import split_text_by_words

# texts 생성 후
expanded_texts = []
for text in texts:
    chunks = split_text_by_words(text, words_per_chunk=12)
    expanded_texts.extend(chunks)

texts = expanded_texts
```

### 이미지 개수 증가
```python
# line 968
bg_images = fetch_keyword_based_images(
    keywords, bno,
    count=len(parts) * 2,  # 파트당 2개 이미지
    video_type=video_type
)
```

---

## 성능 영향

- TTS 생성 시간: +5~10초 (ffmpeg 속도 조정)
- 이미지 검색 시간: +10~20초 (키워드 기반 멀티 검색)
- 렌더링 시간: 동일 (Ken Burns 로직만 변경)
- 썸네일 생성: +5~10초 (관련 이미지 검색)

**총 추가 시간: 약 20~40초**
