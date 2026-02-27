package com.cw.aibot.repository;

import com.cw.aibot.entity.Persona;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface PersonaRepository extends JpaRepository<Persona, String> {
    @Query(value = "SELECT * FROM (SELECT * FROM AI_PERSONA ORDER BY DBMS_RANDOM.VALUE) WHERE ROWNUM <= 3", nativeQuery = true)
    List<Persona> findRandomPersonas();
}