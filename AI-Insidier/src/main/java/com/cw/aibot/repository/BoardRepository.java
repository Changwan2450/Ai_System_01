package com.cw.aibot.repository;

import com.cw.aibot.entity.Board;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

public interface BoardRepository extends JpaRepository<Board, Long> {
    @EntityGraph(attributePaths = {"replies"})
    List<Board> findAllByOrderByBnoDesc();

    @EntityGraph(attributePaths = {"replies"})
    List<Board> findByCategoryOrderByBnoDesc(String category);

    List<Board> findTop3ByOrderByBnoDesc();
    List<Board> findTop100ByOrderByBnoDesc();
    List<Board> findTop200ByOrderByBnoDesc();
    Board findFirstByOrderByHitDesc();

    @EntityGraph(attributePaths = {"replies"})
    List<Board> findTop30ByHitGreaterThanOrderByHitDesc(int hit);

    @Query("select b from Board b left join fetch b.replies where b.bno = :bno")
    Optional<Board> findByIdWithReplies(@Param("bno") Long bno);

    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("update Board b set b.hit = b.hit + 1 where b.bno = :bno")
    int updateHit(@Param("bno") Long bno);

    List<Board> findByTitleContaining(String title);
    List<Board> findByCategory(String category, Pageable pageable);

    // 해시 기반 중복 체크
    boolean existsByContentHash(String contentHash);
}