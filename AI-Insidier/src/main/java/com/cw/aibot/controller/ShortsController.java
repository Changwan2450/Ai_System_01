package com.cw.aibot.controller;

import com.cw.aibot.service.ShortsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/shorts")
@RequiredArgsConstructor
public class ShortsController {

    private final ShortsService shortsService;

    /**
     * Python 공장 상태 조회
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getFactoryStatus() {
        log.info(">>> Python 공장 상태 조회");
        Map<String, Object> status = shortsService.checkFactoryStatus();
        return ResponseEntity.ok(status);
    }

    /**
     * 수동 큐레이션 요청
     */
    @PostMapping("/curate")
    public ResponseEntity<Map<String, Object>> requestCuration(
            @RequestParam(defaultValue = "1") int agroCount,
            @RequestParam(defaultValue = "1") int infoCount,
            @RequestParam(defaultValue = "6.5") double minQuality
    ) {
        log.info(">>> 수동 큐레이션 요청: 어그로={}, 정보={}, 품질={}", agroCount, infoCount, minQuality);

        Map<String, Object> result = shortsService.requestPremiumCuration(agroCount, infoCount, minQuality);

        if ((Boolean) result.get("success")) {
            return ResponseEntity.ok(result);
        } else {
            return ResponseEntity.internalServerError().body(result);
        }
    }

    /**
     * 수동 제작 요청
     */
    @PostMapping("/generate/{bno}")
    public ResponseEntity<Map<String, Object>> requestGeneration(
            @PathVariable Long bno,
            @RequestParam(defaultValue = "INFO") String videoType
    ) {
        log.info(">>> 수동 제작 요청: BNO={}, TYPE={}", bno, videoType);

        boolean success = shortsService.requestShortsGeneration(bno, videoType);

        if (success) {
            return ResponseEntity.ok(Map.of("success", true, "message", "제작 요청 성공"));
        } else {
            return ResponseEntity.internalServerError().body(
                    Map.of("success", false, "error", "제작 요청 실패")
            );
        }
    }

    /**
     * 성과 통계 조회
     */
    @GetMapping("/performance")
    public ResponseEntity<Map<String, Object>> getPerformance(
            @RequestParam(defaultValue = "30") int days
    ) {
        log.info(">>> 성과 통계 조회: days={}", days);

        Map<String, Object> stats = shortsService.getPerformanceStats(days);
        return ResponseEntity.ok(stats);
    }
}