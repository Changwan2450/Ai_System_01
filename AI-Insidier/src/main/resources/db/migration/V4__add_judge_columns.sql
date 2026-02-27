-- PR-JUDGE: 감별사 AI 컬럼 추가
-- shorts_queue 테이블에 LLM 심사 결과 저장

-- 심사 결과 컬럼 추가 (idempotent)
ALTER TABLE shorts_queue ADD (
    judge_verdict VARCHAR2(10) DEFAULT NULL,  -- PASS, HOLD, DROP
    judge_score NUMBER(2) DEFAULT NULL,       -- 0-10
    judge_angle VARCHAR2(50) DEFAULT NULL,    -- 논쟁유도형, 정보제공형 등
    risk_flags VARCHAR2(500) DEFAULT NULL     -- clickbait,unverified (CSV)
);

-- 인덱스 추가: PASS 필터링 최적화
CREATE INDEX idx_sq_judge_verdict ON shorts_queue(judge_verdict);

-- 코멘트
COMMENT ON COLUMN shorts_queue.judge_verdict IS 'LLM 심사 결과: PASS/HOLD/DROP';
COMMENT ON COLUMN shorts_queue.judge_score IS 'LLM 점수 (0-10)';
COMMENT ON COLUMN shorts_queue.judge_angle IS '콘텐츠 앵글 (예: 논쟁유도형)';
COMMENT ON COLUMN shorts_queue.risk_flags IS '위험 플래그 CSV (예: clickbait,unverified)';
