# 플레이그라운드 잔손질 (지시서)
1. 연습 압박 수비(`TeamAI.practiceDefender`)가 공 가진 선수와 거의 겹친다(최단 거리 0.02m). 몸끼리 0.6m 이상 떨어지게 목표점을 공 쪽 앞(소유자와 공 사이)으로, `separatePlayers` 와 충돌하지 않게.
2. 상대가 없는 시나리오에서 summary `nearestOpponent` 가 0 → `null`. `firstWithin2m` 처럼.
3. slide 시나리오에서 사용자 슬라이딩이 `tackleAttempts` 에 안 잡힌다 → 사용자·상대 태클을 나눠 집계 (`userTackles`, `opponentTackles`).
4. summary에 `skills`: 개인기 id별 횟수.
5. `tests/playground-script.test.ts` 에 위 항목 테스트. `pnpm typecheck && pnpm test && pnpm build`. AGENTS.md 규칙.
