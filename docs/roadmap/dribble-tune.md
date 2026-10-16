# 터치 드리블 튜닝 마무리 (지시서 2)

현재 상태: 커밋 "WIP: dribble tuning" (사용자 드리블은 목표 거의 충족, AI 드리블이 느림).

## 측정 기준 (데이터로만 판단)
- `tests/dribble-play.test.ts`: 킥오프 직후 사용자 입력(앞→뒤→위→아래→앞+질주) 30경기. 현재 touch: 전진 1071m(예전 913), 잃음 5(8), 뒤로 전환 **0.47초(목표 ≤0.45)**, 90° 0.26초. → 뒤로 전환만 고치면 통과.
- AI 드리블 측정 (새 테스트로 추가할 것, `tests/dribble-ai.test.ts`): `simulation(seed, { kickMotion: true, userControl: false })` 10경기 × 300초, `dribbleTouches: false`(예전) 와 비교.
  - 소유자(키퍼 제외) 1초당 공격 방향 전진 거리: 지금 1.09m/s, 예전 2.41m/s → **예전의 85% 이상**
  - 슛 합계: 지금 약 22, 예전 43 → **예전의 80% 이상**
  - 헤비 터치(`heavyTouch` 이벤트) 10경기 합계 ≤ 10
  - 공이 발끝(pos + facing·0.35)에서 0.75m 넘게 떨어져 쫓는 시간 비율: 지금 38%, 예전 2% → 15% 이하

## 원인 분석 (확인됨)
AI는 상대를 피하느라 드리블 방향을 자주 바꾸는데, 방향을 꺾는 터치는 공이 발끝 `DRIBBLE.turnReach`(0.7m) 안일 때만 된다. 그래서 공이 옛 방향으로 굴러가고 AI가 그걸 쫓느라(38%) 전진이 느리다.

## 해볼 것 (측정하며 고를 것)
1. 발을 뻗어 닿는 거리: `DRIBBLE.reach`·`turnReach`를 0.9~1.0으로, `turnAngle` 0.25~0.35.
2. 공이 reach 밖이지만 1.2m 안이고 의도 방향과 공 방향이 크게 다르면, 선수가 공 쪽으로 가는 동안(`guideDribble`) 몸도 공을 향하게 해서 빨리 닿게.
3. AI 드리블 의도(`TeamAI.decideWithBall` 4번 드리블)의 방향이 결정마다 크게 흔들리지 않게 이전 방향과 섞기(예: 0.5).
4. 뒤로 전환(180°): `turnMax`, `turnSlowdown` 조정 또는 180°일 때 발바닥으로 끌어 돌리는 터치(공 속도를 0 근처로 줄이고 몸을 돌림).

## 완료 조건
- 위 측정 조건 전부 + 기존 테스트 전부 통과 (`pnpm typecheck && pnpm test && pnpm build`). 기존 테스트 기대값을 낮추지 말 것.
- 값은 `src/config.ts` `DRIBBLE`에, 왜 그 값인지 측정 결과를 주석으로.
- 마지막 보고에 측정 표(예전/변경 전/변경 후).

## 지킬 것
`AGENTS.md` 규칙. git push 금지. 커밋 메시지 끝 `Co-Authored-By: Codex <noreply@openai.com>`.
