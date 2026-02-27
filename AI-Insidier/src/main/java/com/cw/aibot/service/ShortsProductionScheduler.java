package com.cw.aibot.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class ShortsProductionScheduler {
    private final ShortsService shortsService;

    @Scheduled(cron = "0 0 9,21 * * *") // 매일 09:00, 21:00
    public void produceShorts() {
        log.info("===== [숏츠 큐레이션 및 제작 시작] =====");
        Map<String, Object> curationResult = shortsService.requestPremiumCuration(2, 2, 6.5);

        if (!Boolean.TRUE.equals(curationResult.get("success"))) {
            log.error("❌ 큐레이션 실패: {}", curationResult.get("error"));
            return;
        }

        Map<String, Object> data = (Map<String, Object>) curationResult.get("data");
        List<Map<String, Object>> agroList = (List<Map<String, Object>>) data.get("agro");
        List<Map<String, Object>> infoList = (List<Map<String, Object>>) data.get("info");

        log.info("✅ 큐레이션 결과: 어그로 {}개, 정보 {}개", agroList.size(), infoList.size());

        for (Map<String, Object> item : agroList) {
            Long bno = ((Number) item.get("bno")).longValue();
            if (shortsService.requestShortsGeneration(bno, "AGRO")) {
                log.info("✅ 어그로 숏츠 제작 요청 성공: BNO={}", bno);
            } else {
                log.error("❌ 어그로 숏츠 제작 요청 실패: BNO={}", bno);
            }
        }

        for (Map<String, Object> item : infoList) {
            Long bno = ((Number) item.get("bno")).longValue();
            if (shortsService.requestShortsGeneration(bno, "INFO")) {
                log.info("✅ 정보 숏츠 제작 요청 성공: BNO={}", bno);
            } else {
                log.error("❌ 정보 숏츠 제작 요청 실패: BNO={}", bno);
            }
        }
    }
}