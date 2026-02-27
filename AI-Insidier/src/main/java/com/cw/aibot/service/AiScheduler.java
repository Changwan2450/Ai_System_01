package com.cw.aibot.service;

import com.cw.aibot.DTO.RawTopic;
import com.cw.aibot.entity.Board;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class AiScheduler {
    private final CrawlingService crawlingService;
    private final AiPostGenerationService postGenerationService;
    private final ReplyGenerationService replyGenerationService;
    private final ShortsService shortsService;
    private final TransactionTemplate transactionTemplate;

    @Scheduled(fixedDelay = 1_800_000) // 30분
    public void scheduledPostCreation() {
        log.info("===== [🔥 AI 어그로 게시글 + 숏츠 스크립트 생성 시작] =====");
        try {
            // 해시 필터링으로 더 많이 수집 후 걸러냄 (소스별 균등 분배)
            List<RawTopic> topics = crawlingService.fetchLatestTopics(15);
            if (topics.isEmpty()) {
                log.warn("⚠️ 수집된 토픽 없음 (모두 해시 중복이거나 크롤링 실패)");
                return;
            }

            int created = 0;
            int skipped = 0;
            for (RawTopic topic : topics) {
                if (created >= 3) break; // 주기당 최대 3개

                Board board = transactionTemplate.execute(status -> {
                    try {
                        return postGenerationService.generateShockingPost(topic);
                    } catch (Exception e) {
                        log.error("❌ 게시글 생성 중 오류: {}", e.getMessage());
                        status.setRollbackOnly();
                        return null;
                    }
                });

                if (board != null) {
                    // 거친 댓글 3개 생성 (찬성/반대/야유)
                    replyGenerationService.generateReplies(board);

                    // 숏츠 제작 요청 (비디오 타입 자동 결정됨)
                    String videoType = board.getShortsScript() != null
                            && board.getShortsScript().contains("AGRO") ? "AGRO" : "INFO";
                    boolean requested = shortsService.requestShortsGeneration(board.getBno(), videoType);
                    if (requested) {
                        log.info("✅ 숏츠 제작 요청 성공: BNO={}", board.getBno());
                    } else {
                        log.warn("⚠️ 숏츠 제작 요청 실패 (Python 서버 확인 필요): BNO={}", board.getBno());
                    }

                    created++;
                } else {
                    skipped++;
                }
            }
            log.info("===== [완료] 생성: {}개, 스킵: {}개, 토픽 총: {}개 =====", created, skipped, topics.size());
        } catch (Exception e) {
            log.error("🚨 스케줄러 치명적 오류: {}", e.getMessage(), e);
        }
    }
}