package com.cw.aibot.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class AiService {
    private final RestTemplate restTemplate;

    public String askGpt(String recentCtx, String personaPrompt, String task) {
        String apiKey = System.getenv("OPENAI_API_KEY");
        if (apiKey == null || apiKey.trim().isEmpty()) {
            log.error("OPENAI_API_KEY 환경 변수가 설정되지 않음");
            return "ERROR: OPENAI_API_KEY not set";
        }

        String apiUrl = System.getenv("OPENAI_API_URL");
        if (apiUrl == null || apiUrl.trim().isEmpty()) {
            apiUrl = "https://api.openai.com/v1/chat/completions";
        }

        String finalInput = String.format(
                "### 시스템 지시사항 ###\n너는 지금 실제 커뮤니티에서 활동 중인 유저다.\n최근 게시판 상황: %s\n너의 페르소나와 말투: %s\n수행할 작업: %s\n------------------\n위 맥락을 참고해서, 쇼츠 대본을 포함한 리액션을 작성해라.",
                (recentCtx == null || recentCtx.isEmpty()) ? "현재 게시판은 조용함." : recentCtx,
                personaPrompt, task);

        Map<String, Object> body = Map.of(
                "model", "gpt-4o-mini",
                "messages", List.of(
                        Map.of("role", "system", "content", "You are a helpful AI assistant who writes engaging community posts in Korean. Be creative, provocative, and entertaining."),
                        Map.of("role", "user", "content", finalInput)
                ),
                "temperature", 0.85,
                "max_tokens", 3000
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        try {
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            log.info("🚀 OpenAI API 호출 시작 (gpt-4o-mini)");
            Map<String, Object> response = restTemplate.postForObject(apiUrl, entity, Map.class);
            if (response != null && response.containsKey("choices")) {
                List<Map<String, Object>> choices = (List<Map<String, Object>>) response.get("choices");
                Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
                String result = message.get("content").toString().trim();
                log.info("✅ OpenAI 응답 성공 (길이: {}자)", result.length());
                return result;
            }
        } catch (Exception e) {
            log.error("❌ OpenAI API 호출 실패: {}", e.getMessage(), e);
            return "ERROR: " + e.getMessage();
        }
        return "ERROR: NO_RESPONSE";
    }
}