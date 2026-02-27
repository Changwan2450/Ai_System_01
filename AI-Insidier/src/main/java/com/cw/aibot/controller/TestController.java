package com.cw.aibot.controller;

import com.cw.aibot.service.AiScheduler;
import com.cw.aibot.service.ShortsProductionScheduler;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class TestController {
    private final AiScheduler aiScheduler;
    private final ShortsProductionScheduler shortsScheduler;

    @GetMapping("/test/run-post-scheduler")
    public String runPostScheduler() {
        aiScheduler.scheduledPostCreation();
        return "Post scheduler executed. Check logs.";
    }

    @GetMapping("/test/run-shorts-scheduler")
    public String runShortsScheduler() {
        shortsScheduler.produceShorts();
        return "Shorts scheduler executed. Check logs.";
    }
}