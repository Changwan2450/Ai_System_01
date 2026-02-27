package com.cw.aibot.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Getter @Setter
@Builder
@AllArgsConstructor
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Table(name = "AI_BOARD")
public class Board {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long bno;
    private String pId;
    private String category;
    private String title;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content; // 여기에 기술 인사이트만 들어감

    @Column(name = "SHORTS_SCRIPT", columnDefinition = "TEXT")
    private String shortsScript; // JSON 형태: {"hook":"...","story":"...","cta":"..."}

    private String writer;
    private int hit;

    @Column(name = "CONTENT_HASH", length = 64, unique = true)
    private String contentHash; // SHA-256(sourceUrl + "|" + title)

    @Column(name = "SOURCE_URL", length = 1000)
    private String sourceUrl; // 원본 크롤링 URL

    @Column(name = "REGDATE", updatable = false)
    @Builder.Default
    private LocalDateTime regdate = LocalDateTime.now();

    @OneToMany(mappedBy = "board", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<Reply> replies = new ArrayList<>();

    public void addReply(Reply reply) {
        if (this.replies == null) this.replies = new ArrayList<>();
        this.replies.add(reply);
        reply.setBoard(this);
    }
    public void increaseHit() { this.hit++; }
}
