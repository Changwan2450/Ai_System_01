package com.cw.aibot.DTO;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * PR-JUDGE: 감별사 AI 판정 결과
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JudgeResult {
    /**
     * 판정: PASS, HOLD, DROP
     */
    private String verdict;

    /**
     * LLM 점수 (0-10)
     */
    private int score;

    /**
     * 콘텐츠 앵글 (예: "논쟁유도형", "정보제공형", "팩트체크형")
     */
    private String angle;

    /**
     * 판정 근거
     */
    private String reason;

    /**
     * 위험 플래그 (예: ["clickbait", "unverified"])
     */
    private List<String> riskFlags;

    /**
     * 필수 포함 요소 (예: ["출처언급", "반박근거"])
     */
    private List<String> mustInclude;

    /**
     * pre_score (0-100, 규칙 기반)
     */
    private int preScore;
}
