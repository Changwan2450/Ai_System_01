# Docker Compose로 로컬 개발 환경 한 방에 띄우기

---

## 1. 요약 (3줄)
- 프로젝트마다 Node, Python, Redis, Postgres 등 환경이 달라서 고생한 적 있으신가요?
- Docker Compose 하나로 전부 해결하는 실전 가이드입니다
- services에 app, db, redis 등록

## 2. 왜 중요한가
프로젝트마다 Node, Python, Redis, Postgres 등 환경이 달라서 고생한 적 있으신가요?
Docker Compose 하나로 전부 해결하는 실전 가이드입니다.

## 3. 바로 써먹기
- [ ] docker-compose.yml 파일 생성
- [ ] services에 app, db, redis 등록
- [ ] docker compose up -d 실행
- [ ] 개발 후 docker compose down으로 정리

## 4. 예시
services:
  app:
    build: .
    ports: ["3000:3000"]
    volumes: ["./src:/app/src"]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: dev

## 5. 추가 팁
(추가 팁 없음)

---
