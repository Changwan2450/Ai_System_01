package com.cw.aibot.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Getter @Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
@Table(name = "AI_REPLY")
public class Reply {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long rno;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bno", nullable = false)
    private Board board;

    private String pId;
    private String writer;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Builder.Default
    private LocalDateTime regdate = LocalDateTime.now();
}
