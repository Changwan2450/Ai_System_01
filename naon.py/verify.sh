#!/bin/bash
set -e

echo "=== 검증 시작 ==="
echo ""

# 1. 서버 재시작
echo "[1] 서버 재시작"
lsof -ti:5001 | xargs kill -9 2>/dev/null || true
sleep 2
.venv/bin/python api_server.py > api_server.log 2>&1 &
sleep 8
echo "✅ 서버 재시작"
echo ""

# 2. Health Check
echo "[2] Health Check"
HEALTH=$(curl -s http://localhost:5001/api/health)
echo "$HEALTH" | .venv/bin/python -m json.tool
echo ""

# 3. 테스트 데이터 준비
echo "[3] 테스트 데이터 준비 (bno=9999)"
PGPASSWORD=hr psql -h localhost -U hr -d postgres << 'EOFSQL' 2>&1 | grep -E "INSERT|UPDATE|DELETE"
DELETE FROM upload_schedule WHERE bno = 9999;
DELETE FROM shorts_queue WHERE bno = 9999;
UPDATE ai_board SET p_id = 'persona_tech' WHERE bno = 9999;
INSERT INTO ai_board (bno, p_id, category, title, content, writer, hit, content_hash)
VALUES (9999, 'persona_tech', 'AI', 'AI 기술 발전 테스트', 'AI 기술이 빠르게 발전하고 있습니다. 특히 대형 언어 모델의 성능이 크게 향상되었습니다. 이는 다양한 산업 분야에 영향을 미치고 있습니다.', 'SYSTEM', 0, 'test_hash_9999')
ON CONFLICT (bno) DO UPDATE SET p_id = 'persona_tech', title = 'AI 기술 발전 테스트', content = 'AI 기술이 빠르게 발전하고 있습니다. 특히 대형 언어 모델의 성능이 크게 향상되었습니다. 이는 다양한 산업 분야에 영향을 미치고 있습니다.';
INSERT INTO shorts_queue (bno, video_type, quality_score, priority, status)
VALUES (9999, 'INFO', 7.5, 5, 0);
EOFSQL
echo "✅ 테스트 데이터 준비"
echo ""

# 4. Generate API 호출
echo "[4] Generate API 호출"
RESULT=$(curl -s -X POST http://localhost:5001/api/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${FACTORY_API_KEY:?FACTORY_API_KEY not set}" \
  -d '{"bno": 9999, "video_type": "INFO"}')
echo "$RESULT" | .venv/bin/python -m json.tool
echo ""

# 5. DB 확인
echo "[5] DB 확인"
PGPASSWORD=hr psql -h localhost -U hr -d postgres << 'EOFSQL' 2>&1 | grep -A 5 "bno\|---"
SELECT bno, status, LENGTH(video_path) as path_len, LENGTH(thumbnail_path) as thumb_len 
FROM shorts_queue WHERE bno = 9999;

SELECT bno, scheduled_time, status 
FROM upload_schedule WHERE bno = 9999;
EOFSQL
echo ""

# 6. 파일 검증
echo "[6] 파일 검증"
if [ -f output/shorts_INFO_9999.mp4 ]; then
  SIZE=$(ls -lh output/shorts_INFO_9999.mp4 | awk '{print $5}')
  DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 output/shorts_INFO_9999.mp4 2>/dev/null | cut -d. -f1)
  echo "✅ shorts_INFO_9999.mp4: ${SIZE}, ${DUR}s"
else
  echo "❌ shorts_INFO_9999.mp4 없음"
fi

if [ -f output/thumb_INFO_9999.jpg ]; then
  TSIZE=$(ls -lh output/thumb_INFO_9999.jpg | awk '{print $5}')
  echo "✅ thumb_INFO_9999.jpg: ${TSIZE}"
else
  echo "❌ thumb_INFO_9999.jpg 없음"
fi
echo ""

echo "=== 검증 완료 ==="
