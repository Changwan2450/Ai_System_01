package com.cw.aibot.DTO;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

/**
 * 렉카형 숏츠 대본 DTO
 * intro / body_1 / body_2 / outro 구조 — 영상 편집기 즉시 사용 가능
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class ShortsScriptDTO {
    private Long bno;
    private String title;
    private String category;
    private String writer;
    private String videoType;       // ENTERTAINMENT / INFO / TREND / COMMUNITY
    private String sourceUrl;
    private String generatedAt;

    // ===== 60초 타임라인 (intro → body_1 → body_2 → outro) =====
    private List<TimelineSegment> timeline;

    // ===== 5인 페르소나 댓글 =====
    private List<PersonaComment> comments;

    // ===== 영상 스타일 (LLM_POLICY 준수) =====
    private VisualStyle visual;
    private AudioStyle audio;

    // ===== 메타데이터 =====
    private ScriptMeta meta;

    /**
     * 초단위 분절 세그먼트
     */
    @Data @Builder @AllArgsConstructor @NoArgsConstructor
    public static class TimelineSegment {
        private String section;      // intro / body_1 / body_2 / outro
        private String label;        // 인트로 / 핵심팩트 / 반전논쟁 / 아웃트로
        private int startSec;
        private int endSec;
        private int durationSec;
        private String text;         // 나레이션 텍스트
        private String direction;    // 연출 지시
    }

    /**
     * 5인 페르소나 댓글
     */
    @Data @Builder @AllArgsConstructor @NoArgsConstructor
    public static class PersonaComment {
        private int order;           // 1~5
        private String archetype;    // 냉철한_분석가 등
        private String writer;
        private String content;
        private int sentenceCount;
    }

    /**
     * 영상 비주얼 스타일 — Dark Cinematic / Cyberpunk Neon, NO RED
     */
    @Data @Builder @AllArgsConstructor @NoArgsConstructor
    public static class VisualStyle {
        private String theme;            // dark_cinematic / cyberpunk_neon
        private String captionHighlight; // #FFD100 (Bold Yellow)
        private String captionBase;      // #FFFFFF
        private String font;             // Pretendard
        private boolean noRedBg;         // true
    }

    /**
     * 음성 스타일 — Energetic, 1.25x+
     */
    @Data @Builder @AllArgsConstructor @NoArgsConstructor
    public static class AudioStyle {
        private double voiceSpeed;       // 1.25
        private String tone;             // energetic
        private String avoid;            // news_anchor_robotic
    }

    /**
     * 스크립트 메타정보
     */
    @Data @Builder @AllArgsConstructor @NoArgsConstructor
    public static class ScriptMeta {
        private int totalDurationSec;
        private int segmentCount;
        private int commentCount;
        private int contentLength;
        private String quality;      // PREMIUM / STANDARD
    }
}