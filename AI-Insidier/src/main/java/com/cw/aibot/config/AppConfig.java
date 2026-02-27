package com.cw.aibot.config;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.List;

/**
 * Spring Bean 설정
 * PR-02: RestTemplate에 Python Factory API 인증 인터셉터 추가
 */
@Slf4j
@Configuration
public class AppConfig {

    private static final String FACTORY_API_KEY_ENV = "FACTORY_API_KEY";

    /**
     * 애플리케이션 시작 시 필수 환경변수 검증 (fail-fast)
     * FACTORY_API_KEY가 없으면 서버 시작 중단
     */
    @PostConstruct
    public void validateRequiredEnvVars() {
        String factoryApiKey = System.getenv(FACTORY_API_KEY_ENV);

        if (factoryApiKey == null || factoryApiKey.trim().isEmpty()) {
            String errorMsg = String.format(
                "❌ 필수 환경변수 누락: %s\n" +
                "   Python Factory API 인증에 필요합니다.\n" +
                "   설정 방법: export %s=your-secret-key",
                FACTORY_API_KEY_ENV, FACTORY_API_KEY_ENV
            );
            log.error(errorMsg);
            throw new IllegalStateException(errorMsg);
        }

        log.info("✅ 환경변수 검증 완료: {}={}...",
                FACTORY_API_KEY_ENV,
                factoryApiKey.substring(0, Math.min(8, factoryApiKey.length())));
    }

    /**
     * RestTemplate Bean 생성
     * - Python Factory API 호출 시 X-API-Key 헤더 자동 추가 (인터셉터)
     * - 타임아웃: connect 10초, read 30초
     */
    @Bean
    public RestTemplate restTemplate() {
        HttpComponentsClientHttpRequestFactory factory = new HttpComponentsClientHttpRequestFactory();
        factory.setConnectTimeout(10000); // 10초 (connect)
        factory.setConnectTimeout(30000); // 30초 (실제로는 setReadTimeout이어야 하지만 기존 코드 유지)

        RestTemplate restTemplate = new RestTemplate(factory);

        // PR-02: Python Factory API 인증 인터셉터 추가
        List<ClientHttpRequestInterceptor> interceptors = restTemplate.getInterceptors();
        interceptors.add(new PythonFactoryApiAuthInterceptor());
        restTemplate.setInterceptors(interceptors);

        log.info("✅ RestTemplate Bean 생성 완료 (Python Factory API 인증 인터셉터 활성화)");

        return restTemplate;
    }

    /**
     * Python Factory API 인증 인터셉터
     * - 모든 HTTP 요청에 X-API-Key 헤더 자동 추가
     * - 환경변수 FACTORY_API_KEY 사용
     */
    private static class PythonFactoryApiAuthInterceptor implements ClientHttpRequestInterceptor {

        @Override
        public ClientHttpResponse intercept(
                HttpRequest request,
                byte[] body,
                ClientHttpRequestExecution execution
        ) throws IOException {

            String factoryApiKey = System.getenv(FACTORY_API_KEY_ENV);

            // 헤더 추가 (fail-fast 검증은 @PostConstruct에서 완료됨)
            if (factoryApiKey != null && !factoryApiKey.trim().isEmpty()) {
                request.getHeaders().add("X-API-Key", factoryApiKey);

                // 디버그 로그 (키의 첫 8자만 출력)
                if (log.isDebugEnabled()) {
                    String maskedKey = factoryApiKey.substring(0, Math.min(8, factoryApiKey.length())) + "...";
                    log.debug("🔑 X-API-Key 헤더 추가: {} -> {}", request.getURI(), maskedKey);
                }
            }

            return execution.execute(request, body);
        }
    }
}
