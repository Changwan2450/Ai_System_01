package com.cw.aibot.controller;

import com.cw.aibot.entity.Board;
import com.cw.aibot.entity.Reply;
import com.cw.aibot.repository.BoardRepository;
import com.cw.aibot.repository.ReplyRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Controller;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@Controller
@RequestMapping("/board")
@RequiredArgsConstructor
public class BoardController {

    private final BoardRepository boardRepo;
    private final ReplyRepository replyRepo;

    /**
     * 게시판 리스트 (베스트, 카테고리 필터 포함)
     */
    @GetMapping("/list")
    @Transactional(readOnly = true)
    public String list(
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "sort", required = false) String sort,
            Model model) {

        List<Board> list;

        // 1. 베스트 게시글 (조회수 기준)
        if ("best".equals(sort)) {
            list = boardRepo.findTop30ByHitGreaterThanOrderByHitDesc(79);
            model.addAttribute("boardTitle", "🔥 실시간 베스트");
        }
        // 2. 카테고리별 필터링
        else if (category != null && !category.isEmpty()) {
            list = boardRepo.findByCategoryOrderByBnoDesc(category);
            model.addAttribute("boardTitle", "📌 " + category + " 게시판");
        }
        // 3. 전체 목록
        else {
            list = boardRepo.findAllByOrderByBnoDesc();
            model.addAttribute("boardTitle", "💬 자유 게시판");
        }

        model.addAttribute("list", list);
        model.addAttribute("category", category);
        model.addAttribute("sort", sort);
        return "list";
    }

    /**
     * 게시글 상세 페이지 (댓글 데이터 전달 핵심 로직)
     */
    @GetMapping("/detail/{bno}")
    @Transactional // Dirty Checking(조회수 증가)을 위해 Transactional 유지
    public String detail(@PathVariable("bno") Long bno, Model model) {
        log.info(">>>> 상세페이지 진입: bno={}", bno);

        try {
            // 1. 게시글과 댓글을 Fetch Join으로 한 번에 가져옴 (N+1 문제 해결)
            Board board = boardRepo.findByIdWithReplies(bno)
                    .orElseThrow(() -> new RuntimeException("게시글 없음: " + bno));

            // 2. 조회수 증가
            board.setHit(board.getHit() + 1);

            // 3. 모델에 데이터 주입 (HTML에서 사용할 이름들)
            model.addAttribute("board", board);

            // ✅ 형, HTML에서 ${replies} 루프 돌리려면 이 줄이 무조건 있어야 해!
            model.addAttribute("replies", board.getReplies());

            return "detail";

        } catch (Exception e) {
            log.error("!!!! 상세페이지 에러 발생: ", e);
            return "redirect:/ai/board/list";
        }
    }

    /**
     * 댓글 수동 등록 (테스트용)
     */
    @PostMapping("/reply/{bno}")
    @Transactional
    public String addReply(@PathVariable("bno") Long bno, Reply reply) {
        try {
            Board board = boardRepo.findById(bno)
                    .orElseThrow(() -> new RuntimeException("해당 게시글이 존재하지 않습니다."));

            // 연관관계 편의 메서드 세팅
            reply.setBoard(board);
            replyRepo.save(reply);

            return "redirect:/ai/board/detail/" + bno;
        } catch (Exception e) {
            log.error(">>>> 댓글 등록 중 오류: ", e);
            return "redirect:/ai/board/list";
        }
    }
}
