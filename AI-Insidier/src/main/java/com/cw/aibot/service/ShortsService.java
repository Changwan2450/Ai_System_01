package com.cw.aibot.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class ShortsService {
    private final RestTemplate restTemplate;
    private final JdbcTemplate jdbcTemplate;



    private String getPythonApiUrl() {
        String url = System.getenv("PYTHON_API_URL");
        if (url == null || url.trim().isEmpty()) {
            url = "http://localhost:5001";
        }
        return url;
    }
    
    public Map<String, Object> requestPremiumCuration(int agroCount, int infoCount, double minQuality) {
        String url = getPythonApiUrl() + "/api/curate/premium";
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("agro_count", agroCount);
            requestBody.put("info_count", infoCount);
            requestBody.put("min_quality_score", minQuality);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            log.info("🎯 Python 큐레이션 요청: 어그로={}, 정보={}, 최소품질={}", agroCount, infoCount, minQuality);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Map<String, Object> body = response.getBody();
                Boolean success = (Boolean) body.get("success");
                if (Boolean.TRUE.equals(success)) {
                    log.info("✅ 큐레이션 성공!");
                    return body;
                }
            }
        } catch (Exception e) {
            log.error("❌ 큐레이션 요청 실패: {}", e.getMessage(), e);
        }
        return Map.of("success", false, "error", "큐레이션 실패");
    }

    public boolean requestShortsGeneration(Long bno, String videoType) {
        String url = getPythonApiUrl() + "/api/generate";
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("bno", bno);
            requestBody.put("video_type", videoType);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            log.info("🚀 Python 제작 요청: BNO={}, TYPE={}", bno, videoType);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Map<String, Object> body = response.getBody();
                Boolean success = (Boolean) body.get("success");
                if (Boolean.TRUE.equals(success)) {
                    log.info("✅ 쇼츠 제작 성공! BNO={}", bno);
                    Map<String, Object> data = (Map<String, Object>) body.get("data");
                    if (data != null) {
                        updateShortsQueue(bno, (String) data.get("video_path"), (String) data.get("thumbnail_path"));
                    }
                    return true;
                } else {
                    log.warn("⚠️ Python 제작 실패 응답: {}", body.get("error"));
                    markAsFailed(bno, body.get("error") != null ? body.get("error").toString() : "Unknown error");
                }
            }
        } catch (Exception e) {
            log.error("❌ Python 제작 요청 실패: {}", e.getMessage(), e);
            markAsFailed(bno, e.getMessage());
        }
        return false;
    }

    private void updateShortsQueue(Long bno, String videoPath, String thumbnailPath) {
        try {
            String sql = """
                UPDATE shorts_queue
                SET status = 1,
                    video_path = ?,
                    thumbnail_path = ?,
                    completed_date = SYSDATE
                WHERE bno = ? AND status = 0
                """;
            int updated = jdbcTemplate.update(sql, videoPath, thumbnailPath, bno);
            if (updated > 0) log.info("✅ DB 업데이트 완료: BNO={}", bno);
            else log.warn("⚠️ 업데이트 대상 없음: BNO={}", bno);
        } catch (Exception e) {
            log.error("❌ DB 업데이트 실패: {}", e.getMessage(), e);
        }
    }

    private void markAsFailed(Long bno, String errorMsg) {
        try {
            String sql = """
                UPDATE shorts_queue
                SET status = 9,
                    error_msg = ?,
                    completed_date = SYSDATE
                WHERE bno = ? AND status = 0
                """;
            int updated = jdbcTemplate.update(sql, errorMsg, bno);
            if (updated > 0) log.info("✅ 실패 상태 업데이트: BNO={}", bno);
            else log.warn("⚠️ 실패 업데이트 대상 없음: BNO={}", bno);
        } catch (Exception e) {
            log.error("❌ 실패 상태 업데이트 실패: {}", e.getMessage(), e);
        }
    }

    public Map<String, Object> checkFactoryStatus() {
        String url = getPythonApiUrl() + "/api/status";
        try {
            ResponseEntity<Map> response = restTemplate.getForEntity(url, Map.class);
            if (response.getStatusCode() == HttpStatus.OK) return response.getBody();
        } catch (Exception e) {
            log.error("❌ 공장 상태 체크 실패: {}", e.getMessage());
        }
        return Map.of("success", false, "error", "Python API 연결 실패");
    }

    public Map<String, Object> getPerformanceStats(int days) {
        String url = getPythonApiUrl() + "/api/performance/stats?days=" + days;
        try {
            ResponseEntity<Map> response = restTemplate.getForEntity(url, Map.class);
            if (response.getStatusCode() == HttpStatus.OK) return response.getBody();
        } catch (Exception e) {
            log.error("❌ 성과 조회 실패: {}", e.getMessage());
        }
        return Map.of("success", false, "error", "성과 조회 실패");
    }
}