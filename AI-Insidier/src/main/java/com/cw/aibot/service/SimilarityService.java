package com.cw.aibot.service;

import com.cw.aibot.entity.Board;
import com.cw.aibot.repository.BoardRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class SimilarityService {
    private final BoardRepository boardRepository;

    private static final double WORD_THRESHOLD = 0.6;       // 단어 Jaccard 임계값
    private static final double BIGRAM_THRESHOLD = 0.55;     // 바이그램 임계값
    private static final double TITLE_THRESHOLD = 0.5;       // 제목 전용 임계값

    public boolean isTooSimilar(String newContent) {
        List<Board> recent = boardRepository.findTop200ByOrderByBnoDesc();

        // newContent에서 제목 부분 추정 (첫 50자 또는 첫 줄)
        String newTitle = newContent.contains(" ")
                ? newContent.substring(0, Math.min(50, newContent.length()))
                : newContent;

        for (Board b : recent) {
            String existing = b.getTitle() + " " + b.getContent();

            // 1단계: 제목 유사도 빠른 체크
            double titleSim = jaccardSimilarity(b.getTitle(), newTitle);
            if (titleSim > TITLE_THRESHOLD) {
                log.debug("🔴 제목 유사도 높음: BNO={} ({}), 유사도={}", b.getBno(), b.getTitle(), titleSim);
                return true;
            }

            // 2단계: 단어 레벨 Jaccard
            double wordSim = jaccardSimilarity(existing, newContent);
            if (wordSim > WORD_THRESHOLD) {
                log.debug("🔴 단어 유사도 높음: BNO={} ({}), 유사도={}", b.getBno(), b.getTitle(), wordSim);
                return true;
            }

            // 3단계: 바이그램 유사도 (패러프레이즈 감지)
            double bigramSim = ngramSimilarity(existing, newContent, 2);
            if (bigramSim > BIGRAM_THRESHOLD) {
                log.debug("🔴 바이그램 유사도 높음: BNO={} ({}), 유사도={}", b.getBno(), b.getTitle(), bigramSim);
                return true;
            }
        }
        return false;
    }

    private double jaccardSimilarity(String s1, String s2) {
        String[] words1 = s1.toLowerCase().split("\\W+");
        String[] words2 = s2.toLowerCase().split("\\W+");
        Set<String> set1 = new HashSet<>(Arrays.asList(words1));
        Set<String> set2 = new HashSet<>(Arrays.asList(words2));
        Set<String> intersection = new HashSet<>(set1);
        intersection.retainAll(set2);
        Set<String> union = new HashSet<>(set1);
        union.addAll(set2);
        return union.isEmpty() ? 0.0 : (double) intersection.size() / union.size();
    }

    private double ngramSimilarity(String s1, String s2, int n) {
        Set<String> ngrams1 = generateNgrams(s1.toLowerCase(), n);
        Set<String> ngrams2 = generateNgrams(s2.toLowerCase(), n);
        Set<String> intersection = new HashSet<>(ngrams1);
        intersection.retainAll(ngrams2);
        Set<String> union = new HashSet<>(ngrams1);
        union.addAll(ngrams2);
        return union.isEmpty() ? 0.0 : (double) intersection.size() / union.size();
    }

    private Set<String> generateNgrams(String text, int n) {
        String[] words = text.split("\\W+");
        Set<String> ngrams = new HashSet<>();
        for (int i = 0; i <= words.length - n; i++) {
            StringBuilder sb = new StringBuilder();
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(" ");
                sb.append(words[i + j]);
            }
            ngrams.add(sb.toString());
        }
        return ngrams;
    }
}