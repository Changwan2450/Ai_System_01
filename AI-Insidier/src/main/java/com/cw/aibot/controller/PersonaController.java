package com.cw.aibot.controller;

import com.cw.aibot.entity.Persona;
import com.cw.aibot.repository.PersonaRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequestMapping("/api/persona")
@RequiredArgsConstructor
public class PersonaController {

    private final PersonaRepository personaRepo;

    /**
     * 전체 Persona 정보 제공 (Python용)
     */
    @GetMapping("/all")
    public ResponseEntity<Map<String, Object>> getAllPersonas() {
        try {
            List<Persona> personas = personaRepo.findAll();

            List<Map<String, Object>> personaList = personas.stream()
                    .map(p -> {
                        Map<String, Object> map = new HashMap<>();
                        map.put("pId", p.getPId());
                        map.put("name", p.getName());
                        map.put("job", p.getJob());
                        map.put("prompt", p.getPrompt());
                        map.put("avatar", p.getAvatar());
                        return map;
                    })
                    .collect(Collectors.toList());

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "data", personaList
            ));

        } catch (Exception e) {
            log.error("❌ Persona 조회 실패: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /**
     * 특정 Persona 정보 제공
     */
    @GetMapping("/{pId}")
    public ResponseEntity<Map<String, Object>> getPersona(@PathVariable String pId) {
        try {
            Persona persona = personaRepo.findById(pId)
                    .orElseThrow(() -> new RuntimeException("Persona 없음: " + pId));

            Map<String, Object> data = new HashMap<>();
            data.put("pId", persona.getPId());
            data.put("name", persona.getName());
            data.put("job", persona.getJob());
            data.put("prompt", persona.getPrompt());
            data.put("avatar", persona.getAvatar());

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "data", data
            ));

        } catch (Exception e) {
            log.error("❌ Persona 조회 실패: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("success", false, "error", e.getMessage()));
        }
    }
}