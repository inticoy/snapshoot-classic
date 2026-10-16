# 지시서 3: 동작 엉덩이 높이 버그 + 플레이그라운드

## A. 슬라이딩·다이빙·세리머니가 공중에 뜨는 버그 (원인 확인됨)
- 캐릭터(`public/assets/models/player.glb`)의 `DEF-hips` 부모 뼈 `root`는 **Z가 위**인 로컬 좌표계다 (월드 위 = 부모 로컬 (0,0,1), 실측).
- `scripts/bake-motions.ts`는 엉덩이 위치 중 **로컬 Y만 프레임별로** 저장하고 X·Z는 첫 프레임 값으로 고정한다(`hipsY`, `hipsXZ`). `src/anim/MotionLibrary.ts` `MotionClips.clip()`도 그렇게 복원한다.
- 결과: `motions.json`의 모든 클립에서 hipsY가 0.05로 일정, 높이(로컬 Z)는 고정 → 누운 자세에서도 엉덩이가 선 높이에 떠 있다.
- 고칠 것: 엉덩이 로컬 위치 **3축 모두 프레임별로** 저장/복원 (제자리 처리는 지금처럼 bakeClip에서 월드 수평 성분만 0으로). 포맷 바꿔도 됨(예: `hips: number[]` xyz 반복, 3자리 반올림).
- `npx vite-node scripts/bake-motions.ts`로 다시 굽는다 (`mocap-local/` 원본 필요 — 있음). 굽고 나서 확인:
  - `grf_sliding_sprint_000` 키 프레임 근처 엉덩이 월드 높이 < 0.45m, `mc_celebrate_1`(무릎 꿇기) < 0.6m, `mc_dive_1` 최저 < 0.6m (선 자세 약 0.95m).
  - 테스트 추가 `tests/motion.test.ts`: motions.json을 읽어 위 높이 조건을 검사 (월드 높이 계산은 bake에서 쓰는 GLB 로드 대신, 저장된 부모 로컬 위치의 Z가 줄어드는지로 검사해도 됨).
- 슬라이딩 중 몸이 땅에 닿는지 브라우저로 볼 수 있게 플레이그라운드(B)에 시나리오로 넣는다.

## B. 플레이그라운드 (데이터로 직접 시험하는 개발 페이지)
목적: 사용자가 드리블·방향 전환·태클·킥을 **고립된 상황에서 직접 조작**하며, 동시에 **수치(텔레메트리)**를 보고, 값을 바로 바꿔 본다. 스크린샷이 아니라 데이터로 확인하는 도구.

- 진입: `playground.html` (모션 랩 `motions.html`처럼 별도 페이지, 개발 서버 전용이어도 됨) 또는 `index.html?playground`. 실제 `Game`/`Match` 루프·카메라·조작(키보드·터치)을 그대로 쓴다.
- 시나리오 선택 (버튼):
  1. 빈 경기장 자유 드리블 (상대 없음, 내 공격수 + 공)
  2. 1대1: 수비수 1명이 압박
  3. 압박 속 드리블: 킥오프 직후처럼 상대 3명이 둘러싼다
  4. 패스 받기: 동료가 15m에서 땅볼 패스 → 받고 바로 드리블
  5. 슬라이딩 태클 시험: 내가 수비, 상대가 드리블하며 지나간다 (A 버그 확인용)
  6. 키퍼 1대1 / 슛 연습
  - 리셋 키(R)로 같은 시나리오 즉시 재시작.
- 텔레메트리 패널 (실시간 숫자 + 최근 5초 작은 그래프):
  - 선수 속도, 공 속도, 공-발끝 거리, 몸 방향 vs 입력 방향 각도, 공 진행 방향 vs 입력 방향 각도
  - 터치 수(초당), 마지막 방향 전환에 걸린 시간(입력이 바뀐 순간부터 공 진행 방향이 입력 ±30° 안에 들어올 때까지), 헤비 터치·소유 상실 횟수
  - 현재 재생 중인 동작 id(킥·슬라이딩 등 모션 라이브러리), 엉덩이 높이
- 파라미터 패널: `DRIBBLE`의 주요 값(leadWalk, leadSprint, touchPeriod, reach, turnReach, turnAngle, turnMin, turnMax, turnSlowdown, pressureRange, pressureKnock), `MOTION_SELECT.windup`을 슬라이더로 실시간 변경. "현재 값 복사"(JSON) 버튼.
- 기록: 입력·상태를 매 스텝 기록하고 "CSV/JSON 내보내기" 버튼.
- 모바일에서도 열리게 (터치 조작 그대로).
- 테스트: 텔레메트리 계산(전환 시간 측정 등)은 DOM과 분리한 순수 함수로 만들고 vitest로 검증. 브라우저 스모크 스크립트 `scripts/playground-smoke.mjs` 작성 (샌드박스에서 Chrome이 막히면 "미실행"으로 보고, 재시도 금지).

## 완료 조건
- A의 높이 조건 테스트 통과, B의 순수 함수 테스트 통과, 기존 테스트 전부 통과 (`pnpm typecheck && pnpm test && pnpm build`), 기대값 낮추기 금지.
- 마지막 보고: 고친 원인, 굽기 전/후 엉덩이 높이 수치, 플레이그라운드 사용법(주소, 키).

## 지킬 것
`AGENTS.md` 규칙. git push 금지. `mocap-local/` 원본은 커밋 금지(이미 .gitignore). 커밋 메시지 끝 `Co-Authored-By: Codex <noreply@openai.com>`.
