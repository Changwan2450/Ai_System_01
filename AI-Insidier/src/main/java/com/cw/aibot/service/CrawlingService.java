package com.cw.aibot.service;

import com.cw.aibot.DTO.RawTopic;
import com.cw.aibot.repository.BoardRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class CrawlingService {
    private final BoardRepository boardRepo;

    // ===== Zero-Cost RSS Sources (유료 API 없음) =====
    // [카테고리] 연예/스포츠/생활/테크/사회 — 대중적 이슈만 타겟팅
    private static final String[][] SOURCES = {
            // --- Reddit RSS (무료, API 키 불필요) ---
            {"https://www.reddit.com/r/entertainment/top/.rss?t=day", "연예_해외", "rss"},
            {"https://www.reddit.com/r/sports/top/.rss?t=day", "스포츠_해외", "rss"},
            {"https://www.reddit.com/r/todayilearned/top/.rss?t=day", "생활_상식", "rss"},
            {"https://www.reddit.com/r/technology/top/.rss?t=day", "테크_트렌드", "rss"},
            {"https://www.reddit.com/r/worldnews/top/.rss?t=day", "사회_이슈", "rss"},

            // --- 국내 주요 미디어 RSS (무료) ---
            {"https://www.chosun.com/arc/outboundfeeds/rss/category/entertainments/?outputType=xml", "연예_국내", "rss"},
            {"https://www.hankyung.com/feed/sports", "스포츠_국내", "rss"},
            {"https://www.hani.co.kr/rss/science/", "과학_생활", "rss"},

            // --- 글로벌 뉴스 RSS ---
            {"https://news.google.com/rss/search?q=trending+viral&hl=ko&gl=KR", "트렌드_글로벌", "rss"},
            {"https://www.theverge.com/rss/index.xml", "테크_트렌드", "rss"},

            // --- 국내 커뮤니티 (HTML 파싱, headless 불필요) ---
            {"https://www.clien.net/service/group/community?&od=T31", "커뮤니티_클리앙", "html_clien"},
            {"https://www.ppomppu.co.kr/zboard/zboard.php?id=freeboard", "커뮤니티_뽐뿌", "html_ppomppu"},
    };

    /**
     * 다중 소스에서 대중적 이슈를 수집 (SHA-256 해시 중복 차단)
     */
    public List<RawTopic> fetchLatestTopics(int maxTopics) {
        List<RawTopic> topics = new ArrayList<>();
        int perSourceLimit = Math.max(2, maxTopics / SOURCES.length);
        int hashSkipped = 0;
        int crawlFailed = 0;

        for (String[] source : SOURCES) {
            int sourceCount = 0;
            String url = source[0];
            String category = source[1];
            String type = source[2];

            try {
                List<RawTopic> sourceTops;
                if (type.equals("rss")) {
                    sourceTops = parseRss(url, category);
                } else if (type.equals("html_clien")) {
                    sourceTops = parseClien(url, category);
                } else if (type.equals("html_ppomppu")) {
                    sourceTops = parsePpomppu(url, category);
                } else {
                    continue;
                }

                for (RawTopic t : sourceTops) {
                    if (topics.size() >= maxTopics) break;
                    if (sourceCount >= perSourceLimit) break;

                    // SHA-256 해시 중복 체크 (DB 조회, GPT 호출 전 차단)
                    if (boardRepo.existsByContentHash(t.getContentHash())) {
                        hashSkipped++;
                        continue;
                    }

                    topics.add(t);
                    sourceCount++;
                }
            } catch (Exception e) {
                crawlFailed++;
                log.warn("⚠️ 크롤링 실패 [{}]: {}", category, e.getMessage());
            }
        }

        log.info("📊 크롤링 완료: 수집 {}개 | 해시중복 {}개 | 실패소스 {}개 | 총소스 {}개",
                topics.size(), hashSkipped, crawlFailed, SOURCES.length);
        return topics;
    }

    // ========== RSS 파싱 (Reddit, 뉴스, 미디어) ==========
    private List<RawTopic> parseRss(String url, String category) throws IOException {
        List<RawTopic> results = new ArrayList<>();
        Document doc = Jsoup.connect(url)
                .userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
                .timeout(12000)
                .get();

        for (Element item : doc.select("item, entry")) {
            String title = item.select("title").text().trim();
            String link = item.select("link").text().trim();
            if (link.isEmpty()) {
                // Atom feed: <link href="..."/>
                link = item.select("link").attr("href");
            }
            String pubDate = item.select("pubDate, published, updated").text();

            if (title.length() < 10) continue;
            if (title.toLowerCase().contains("sponsored") || title.toLowerCase().contains("ad:")) continue;

            String hash = computeHash(link, title);
            results.add(new RawTopic(title, link, pubDate, category, hash));
        }
        return results;
    }

    // ========== 클리앙 HTML 파싱 ==========
    private List<RawTopic> parseClien(String url, String category) throws IOException {
        List<RawTopic> results = new ArrayList<>();
        Document doc = Jsoup.connect(url)
                .userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
                .timeout(12000)
                .get();

        Elements rows = doc.select(".list_item .subject_fixed");
        for (Element row : rows) {
            Element link = row.selectFirst("a");
            if (link == null) continue;
            String title = link.text().trim();
            String href = "https://www.clien.net" + link.attr("href");

            if (title.length() < 10) continue;

            String hash = computeHash(href, title);
            results.add(new RawTopic(title, href, "", category, hash));
        }
        return results;
    }

    // ========== 뽐뿌 HTML 파싱 ==========
    private List<RawTopic> parsePpomppu(String url, String category) throws IOException {
        List<RawTopic> results = new ArrayList<>();
        Document doc = Jsoup.connect(url)
                .userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
                .timeout(12000)
                .get();

        Elements rows = doc.select(".common_list .list_vspace a.baseList-title");
        if (rows.isEmpty()) {
            rows = doc.select("tr .list_title a");
        }
        for (Element a : rows) {
            String title = a.text().trim();
            String href = a.attr("abs:href");
            if (href.isEmpty()) href = "https://www.ppomppu.co.kr" + a.attr("href");

            if (title.length() < 10) continue;

            String hash = computeHash(href, title);
            results.add(new RawTopic(title, href, "", category, hash));
        }
        return results;
    }

    // ========== SHA-256 해시 ==========
    private String computeHash(String url, String title) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest((url + "|" + title).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}