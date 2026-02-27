package com.cw.aibot.DTO;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class RawTopic {
    private String title;
    private String link;
    private String pubDate;
    private String category;
    private String contentHash; // SHA-256(link + "|" + title)
}