package com.cw.aibot.service;

import com.cw.aibot.entity.Board;
import com.cw.aibot.entity.Persona;
import com.cw.aibot.entity.Reply;
import com.cw.aibot.repository.PersonaRepository;
import com.cw.aibot.repository.ReplyRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class ReplyGenerationService {
    private final AiService aiService;
    private final PersonaRepository personaRepo;
    private final ReplyRepository replyRepo;
    private final Random random = new Random();

    /**
     * 5인 페르소나 아키타입 정의
     * 각자 고유한 관점과 톤으로 최소 2문장 이상의 의견을 제시
     */
    private static final String[][] ARCHETYPES = {
            {"냉철한_분석가", """
                너는 '냉철한 분석가' 유형이다.
                - 감정 배제, 데이터와 논리로 판단
                - "통계적으로 보면~", "구조적 원인은~" 식의 문체
                - 핵심 논점을 짚되, 반드시 근거를 제시
                - 최소 2문장. 단답형(ㄹㅇ, 진짜네, ㅇㅈ) 절대 금지
                """},
            {"감성적_공감자", """
                너는 '감성적 공감자' 유형이다.
                - 당사자 입장에서 공감하며 감정적으로 연결
                - "이 상황이라면 누구든~", "마음이 무거워지네요" 식의 문체
                - 개인 경험이나 유사 사례를 언급하며 공감 확대
                - 최소 2문장. 단답형(ㄹㅇ, 진짜네, ㅇㅈ) 절대 금지
                """},
            {"팩트체커", """
                너는 '팩트체커' 유형이다.
                - 글에서 사실 관계를 검증하고 보완
                - "정확히 말하면~", "추가로 알아둘 점은~" 식의 문체
                - 원문에 없는 관련 사실이나 맥락 정보를 추가 제공
                - 최소 2문장. 단답형(ㄹㅇ, 진짜네, ㅇㅈ) 절대 금지
                """},
            {"위트있는_유머러", """
                너는 '위트 있는 유머러' 유형이다.
                - 날카로운 비유와 위트로 상황을 정리
                - 촌철살인 유머, 기발한 비유, 재치 있는 한 마디
                - 웃기되 저급하지 않게. 지적 유머 선호
                - 최소 2문장. 단답형(ㅋㅋ만, ㄹㅇ, 진짜네) 절대 금지
                """},
            {"현실주의_비평가", """
                너는 '현실주의 비평가' 유형이다.
                - 장밋빛 전망에 찬물 끼얹기 전문
                - "현실적으로 보면~", "간과하고 있는 건~" 식의 문체
                - 반대 의견을 논리적으로 제시하되 건설적 대안 포함
                - 최소 2문장. 단답형(ㄹㅇ, 진짜네, ㅇㅈ) 절대 금지
                """}
    };

    @Transactional
    public void generateReplies(Board board) {
        List<Persona> personas = personaRepo.findAll();
        if (personas.size() < 2) return;

        String contentPreview = board.getContent().substring(0, Math.min(300, board.getContent().length()));
        Set<String> usedPIds = new HashSet<>();
        usedPIds.add(board.getPId()); // 글쓴이 제외

        for (int i = 0; i < 5; i++) {
            String archetypeName = ARCHETYPES[i][0];
            String archetypePrompt = ARCHETYPES[i][1];

            // 중복 페르소나 방지
            Persona replier = pickUniquePersona(personas, usedPIds);
            usedPIds.add(replier.getPId());

            String replyTask = String.format("""
                너는 %s(%s)이다. 온라인 커뮤니티에서 댓글을 단다.

                [역할 지시]
                %s

                [댓글 작성 규칙]
                - 반드시 2문장 이상 작성할 것
                - "ㄹㅇ", "진짜네", "ㅇㅈ", "ㅋㅋ" 같은 단답형/감탄사만으로 구성 금지
                - 자신만의 관점이나 추가 정보를 반드시 포함
                - 존댓말/반말 자유 (페르소나 성격에 맞게)
                - "댓글:", "Reply:" 같은 접두어 붙이지 마라
                - 글 내용에 직접 연결되는 구체적 의견을 내라

                [게시글 정보]
                제목: %s
                카테고리: %s
                내용 요약: %s

                댓글만 출력하라.
                """, replier.getName(), replier.getJob(), archetypePrompt,
                    board.getTitle(), board.getCategory(), contentPreview);

            String replyContent = aiService.askGpt("", replier.getPrompt(), replyTask);

            // 정제: 접두어 제거, 마크다운 제거
            String clean = cleanReply(replyContent);

            // 2문장 미만이면 보완 시도
            if (countSentences(clean) < 2) {
                log.debug("⚠️ 댓글이 너무 짧음 ({}), 보강 시도...", archetypeName);
                String boostReply = aiService.askGpt("", "",
                        "다음 댓글을 2문장 이상으로 확장하라. 단답형 금지. 구체적 의견 추가: " + clean);
                String boosted = cleanReply(boostReply);
                if (boosted.length() > clean.length()) {
                    clean = boosted;
                }
            }

            if (clean.length() < 10) clean = "이 주제에 대해 좀 더 깊이 생각해볼 필요가 있어 보입니다. 단순하게 볼 문제가 아닌 것 같네요.";

            replyRepo.save(Reply.builder()
                    .board(board)
                    .pId(replier.getPId())
                    .writer(replier.getName())
                    .content(clean)
                    .regdate(LocalDateTime.now())
                    .build());

            log.debug("💬 [{}/5] {} ({}): {}", i + 1, replier.getName(), archetypeName,
                    clean.substring(0, Math.min(50, clean.length())) + "...");
        }
        log.info("✅ 5인 페르소나 고품질 댓글 생성 완료: BNO={}", board.getBno());
    }

    private Persona pickUniquePersona(List<Persona> personas, Set<String> usedPIds) {
        // 사용되지 않은 페르소나 우선 선택
        List<Persona> available = personas.stream()
                .filter(p -> !usedPIds.contains(p.getPId()))
                .toList();
        if (!available.isEmpty()) {
            return available.get(random.nextInt(available.size()));
        }
        // 모두 사용된 경우 랜덤
        return personas.get(random.nextInt(personas.size()));
    }

    private String cleanReply(String raw) {
        if (raw == null || raw.startsWith("ERROR")) return "";
        // 첫 3줄까지 취합 (2문장+ 확보)
        String[] lines = raw.split("\n");
        StringBuilder sb = new StringBuilder();
        int lineCount = 0;
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            trimmed = trimmed.replaceAll("[#*]", "")
                             .replaceAll("^(댓글|답글|Reply|Comment)\\s*:?\\s*", "")
                             .replaceAll("^\"|\"$", "")
                             .trim();
            if (trimmed.length() < 3) continue;
            if (sb.length() > 0) sb.append(" ");
            sb.append(trimmed);
            lineCount++;
            if (lineCount >= 3) break;
        }
        return sb.toString().trim();
    }

    private int countSentences(String text) {
        if (text == null || text.isEmpty()) return 0;
        // 마침표, 물음표, 느낌표, 문장 종결 기준
        String[] splits = text.split("[.?!。]+");
        int count = 0;
        for (String s : splits) {
            if (s.trim().length() > 5) count++;
        }
        return Math.max(count, 1);
    }
}