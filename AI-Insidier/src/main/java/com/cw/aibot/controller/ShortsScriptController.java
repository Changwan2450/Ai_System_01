package com.cw.aibot.controller;

import com.cw.aibot.DTO.ShortsScriptDTO;
import com.cw.aibot.DTO.ShortsScriptDTO.*;
import com.cw.aibot.entity.Board;
import com.cw.aibot.entity.Reply;
import com.cw.aibot.repository.BoardRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/shorts-script")
@RequiredArgsConstructor
public class ShortsScriptController {

    private final BoardRepository boardRepo;
    private final ObjectMapper objectMapper;

    private static final String[] ARCHETYPE_NAMES = {
            "냉철한_분석가", "감성적_공감자", "팩트체커", "위트있는_유머러", "현실주의_비평가"
    };

    /**
     * 단건: GET /api/shorts-script/{bno}
     */
    @GetMapping("/{bno}")
    public ResponseEntity<?> getShortsScript(@PathVariable Long bno) {
        Board board = boardRepo.findByIdWithReplies(bno).orElse(null);
        if (board == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(buildShortsDTO(board));
    }

    /**
     * 다건: GET /api/shorts-script/batch?limit=10
     */
    @GetMapping("/batch")
    public ResponseEntity<?> getBatchShortsScripts(@RequestParam(defaultValue = "10") int limit) {
        List<Board> boards = boardRepo.findTop100ByOrderByBnoDesc()
                .stream().limit(limit).toList();
        List<ShortsScriptDTO> dtos = boards.stream()
                .map(b -> buildShortsDTO(boardRepo.findByIdWithReplies(b.getBno()).orElse(b)))
                .toList();
        return ResponseEntity.ok(Map.of("scripts", dtos, "count", dtos.size(), "format", "rekka_timeline_v2"));
    }

    private ShortsScriptDTO buildShortsDTO(Board board) {
        List<TimelineSegment> timeline = parseTimeline(board.getShortsScript());

        // 5인 페르소나 댓글
        List<PersonaComment> comments = new ArrayList<>();
        if (board.getReplies() != null) {
            int idx = 0;
            for (Reply r : board.getReplies()) {
                comments.add(PersonaComment.builder()
                        .order(idx + 1)
                        .archetype(idx < ARCHETYPE_NAMES.length ? ARCHETYPE_NAMES[idx] : "일반")
                        .writer(r.getWriter())
                        .content(r.getContent())
                        .sentenceCount(countSentences(r.getContent()))
                        .build());
                idx++;
            }
        }

        String videoType = determineVideoType(board.getCategory());
        boolean isPremium = board.getContent() != null && board.getContent().length() >= 500 && comments.size() >= 5;

        // LLM_POLICY: Visual & Audio 스타일
        VisualStyle visual = VisualStyle.builder()
                .theme("dark_cinematic")
                .captionHighlight("#FFD100")
                .captionBase("#FFFFFF")
                .font("Pretendard")
                .noRedBg(true)
                .build();
        AudioStyle audio = AudioStyle.builder()
                .voiceSpeed(1.25)
                .tone("energetic")
                .avoid("news_anchor_robotic")
                .build();

        // JSON에서 visual/audio 오버라이드 시도
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> scriptMap = objectMapper.readValue(board.getShortsScript(), Map.class);
            if (scriptMap.containsKey("visual")) {
                @SuppressWarnings("unchecked")
                Map<String, Object> v = (Map<String, Object>) scriptMap.get("visual");
                visual = VisualStyle.builder()
                        .theme(str(v, "theme"))
                        .captionHighlight(str(v, "caption_highlight"))
                        .captionBase(str(v, "caption_base"))
                        .font(str(v, "font"))
                        .noRedBg(Boolean.TRUE.equals(v.get("no_red_bg")))
                        .build();
            }
            if (scriptMap.containsKey("audio")) {
                @SuppressWarnings("unchecked")
                Map<String, Object> a = (Map<String, Object>) scriptMap.get("audio");
                audio = AudioStyle.builder()
                        .voiceSpeed(a.get("voice_speed") instanceof Number n ? n.doubleValue() : 1.25)
                        .tone(str(a, "tone"))
                        .avoid(str(a, "avoid"))
                        .build();
            }
        } catch (Exception ignored) {}

        return ShortsScriptDTO.builder()
                .bno(board.getBno())
                .title(board.getTitle())
                .category(board.getCategory())
                .writer(board.getWriter())
                .videoType(videoType)
                .sourceUrl(board.getSourceUrl())
                .generatedAt(LocalDateTime.now().toString())
                .timeline(timeline)
                .comments(comments)
                .visual(visual)
                .audio(audio)
                .meta(ScriptMeta.builder()
                        .totalDurationSec(60)
                        .segmentCount(timeline.size())
                        .commentCount(comments.size())
                        .contentLength(board.getContent() != null ? board.getContent().length() : 0)
                        .quality(isPremium ? "PREMIUM" : "STANDARD")
                        .build())
                .build();
    }

    @SuppressWarnings("unchecked")
    private List<TimelineSegment> parseTimeline(String script) {
        List<TimelineSegment> segments = new ArrayList<>();

        // 1차: 신규 timeline JSON
        try {
            Map<String, Object> parsed = objectMapper.readValue(script, Map.class);
            List<Map<String, Object>> tl = (List<Map<String, Object>>) parsed.get("timeline");
            if (tl != null) {
                for (Map<String, Object> seg : tl) {
                    String section = str(seg, "section");
                    int start = toInt(seg.get("start_sec"));
                    int end = toInt(seg.get("end_sec"));
                    segments.add(TimelineSegment.builder()
                            .section(section)
                            .label(sectionToLabel(section))
                            .startSec(start).endSec(end).durationSec(end - start)
                            .text(str(seg, "text"))
                            .direction(getDirection(section))
                            .build());
                }
                return segments;
            }
        } catch (Exception ignored) {}

        // 2차: 레거시 hook/story/cta JSON
        try {
            Map<String, String> legacy = objectMapper.readValue(script, Map.class);
            String hook = legacy.getOrDefault("hook", "");
            String story = legacy.getOrDefault("story", "");
            String cta = legacy.getOrDefault("cta", "");
            segments.add(seg("intro", 0, 5, hook));
            segments.add(seg("body_1", 5, 25, story.length() > 200 ? story.substring(0, story.length() / 2) : story));
            segments.add(seg("body_2", 25, 45, story.length() > 200 ? story.substring(story.length() / 2) : ""));
            segments.add(seg("outro", 45, 60, cta));
            return segments;
        } catch (Exception ignored) {}

        // 3차: plain text fallback
        String t = script != null ? script : "";
        segments.add(seg("intro", 0, 5, t.substring(0, Math.min(80, t.length()))));
        segments.add(seg("body_1", 5, 25, t));
        segments.add(seg("body_2", 25, 45, ""));
        segments.add(seg("outro", 45, 60, "님들은 어떻게 생각함? 댓글 ㄱㄱ"));
        return segments;
    }

    private TimelineSegment seg(String section, int start, int end, String text) {
        return TimelineSegment.builder()
                .section(section).label(sectionToLabel(section))
                .startSec(start).endSec(end).durationSec(end - start)
                .text(text).direction(getDirection(section))
                .build();
    }

    private String sectionToLabel(String s) {
        return switch (s) {
            case "intro" -> "인트로(후킹)";
            case "body_1" -> "핵심팩트";
            case "body_2" -> "반전/논쟁";
            case "outro" -> "아웃트로(CTA)";
            // 레거시 호환
            case "hook" -> "인트로(후킹)";
            case "development" -> "핵심팩트";
            case "twist" -> "반전/논쟁";
            case "conclusion" -> "아웃트로(CTA)";
            default -> s;
        };
    }

    private String getDirection(String s) {
        return switch (s) {
            case "intro" -> "Dark Cinematic BG + Bold Yellow(#FFD100) 후킹 텍스트 팝업 + whoosh SFX | Voice 1.25x energetic";
            case "body_1" -> "Cyberpunk Neon 인포그래픽 슬라이드 + White 캡션 | Pretendard Bold | NO RED BG";
            case "body_2" -> "글리치 전환 + 댓글 팝업(Yellow highlight) + 반전 SFX | 속도 유지 1.25x";
            case "outro" -> "Dark Cinematic BG + CTA Yellow 텍스트 + 구독/좋아요 그래픽 | 톤 다운";
            default -> "";
        };
    }

    private String determineVideoType(String cat) {
        if (cat == null) return "INFO";
        if (cat.contains("연예") || cat.contains("스포츠")) return "ENTERTAINMENT";
        if (cat.contains("테크") || cat.contains("과학")) return "INFO";
        if (cat.contains("사회") || cat.contains("트렌드")) return "TREND";
        return "COMMUNITY";
    }

    private int countSentences(String text) {
        if (text == null || text.isEmpty()) return 0;
        int c = 0;
        for (String s : text.split("[.?!。]+")) if (s.trim().length() > 5) c++;
        return Math.max(c, 1);
    }

    private String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v != null ? v.toString() : "";
    }

    private int toInt(Object v) {
        if (v instanceof Number n) return n.intValue();
        try { return Integer.parseInt(String.valueOf(v)); } catch (Exception e) { return 0; }
    }
}