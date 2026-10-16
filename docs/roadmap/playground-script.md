# 플레이그라운드 스크립트 실행 + 압박 시나리오 확인 (지시서)

## 목표
JSON으로 적은 입력을 그대로 재생하고, 결과를 JSON으로 저장해 분석할 수 있게 한다. 브라우저 없이(헤드리스)도 돌아야 한다.

## 1. 스크립트 형식 (`src/playground/Script.ts`, 타입 + 검증)
```json
{
  "scenario": "duel",            // free | duel | pressure | receive | slide | keeper (Scenarios.ts)
  "seed": 1,
  "duration": 6,                 // 초
  "params": { "DRIBBLE.touchPeriod": 0.3 },   // 선택: Parameters.ts 슬라이더와 같은 키
  "opponent": "press",           // 선택: stand | follow | press | tackle (아래 3번)
  "inputs": [
    { "t": 0,   "keys": ["ArrowUp"] },
    { "t": 1.2, "keys": ["ArrowRight", "ShiftLeft"] },
    { "t": 2.0, "tap": ["KeyD"] }          // tap = 한 스텝 눌렀다 뗌
  ],
  "sampleHz": 30
}
```
- `keys`는 그 시각부터 다음 입력까지 누르고 있는 키 전체 (FC 온라인 배치, `src/core/Input.ts`).
- 입력은 DOM 이벤트가 아니라 `Input`의 가상 입력으로 넣는다(결정적 재생). 고정 스텝 120Hz.

## 2. 실행기
- 순수 함수 `runScript(script): ScriptResult` — 렌더 없이 `Match`만 돌린다 (테스트처럼).
- 결과:
  - `frames`: sampleHz마다 { t, user{pos,vel,facing}, ball{pos,vel}, owner, footToBall, opponents[{pos,dist}], keys }
  - `events`: Match 이벤트 (touch, heavyTouch, tackle, foul, kick …, 선수는 이름/번호로 직렬화)
  - `summary`: 소유 비율, 입력 방향별 진행 거리(m)와 정렬 시간(s), 터치 수, 소유 상실 수, 상대 최단 거리 / 처음 2m 안에 들어온 시각, 태클 시도·성공 수
- CLI: `npx vite-node scripts/playground-run.ts <script.json> [out.json]` (out 없으면 summary만 출력). 여러 파일/글롭 지원.
- 브라우저 플레이그라운드: 패널에 "스크립트 실행" (붙여넣기·파일 드롭) → 화면에서 재생 + 같은 결과 JSON 다운로드. `window.__playground.run(script)` 도 제공.
- 예제 `playground/scripts/`: 4방향 드리블 전환, 180° 반전, 1대1 돌파, 압박 탈출, 슬라이딩 태클, 패스 받기 첫 터치. `docs/playground.md`에 사용법 추가.

## 3. 상대 행동 모드 + 압박 버그
- 실측: duel/pressure 시나리오의 진행 거리·소유율이 free와 거의 같다 → 수비수가 실제로 압박하지 않는 것으로 의심.
- 원인을 찾아 고친다. 그리고 상대 행동 모드 `stand | follow | press | tackle` 를 추가 (스크립트 `opponent`, 플레이그라운드 UI 선택). 기본은 시나리오 원래 의도(duel/pressure = press).
- 조작 대상 전환: 플레이그라운드에서 키 하나(예: `Tab`)로 사용자가 상대 수비수를 직접 조작하도록 전환 (스크립트에서는 `"control": "opponent"`).

## 완료 조건 (자동 검증)
- vitest 추가:
  - 같은 스크립트를 두 번 돌리면 결과가 완전히 같다 (결정성).
  - duel(press): 공 가진 사용자가 가만히 있으면 3초 안에 수비수가 1.5m 안, 6초 안에 태클 시도 ≥1.
  - pressure(press): 4초 안에 수비수 2명 이상이 4m 안.
  - stand 모드에서는 수비수가 움직이지 않는다.
  - 예제 스크립트 전부 실행 성공, summary 값이 유한한 수.
- `pnpm typecheck && pnpm test && pnpm build` 통과. 기존 테스트 기대값을 낮추지 말 것.
- 보고서에 예제 스크립트별 summary 표 (free vs duel vs pressure 비교 포함).

## 지킬 것
- AGENTS.md (한국어 주석, git push 금지, 커밋 끝 `Co-Authored-By: Codex <noreply@openai.com>`).
- 게임 본편 동작(`index.html` 일반 경기)은 바꾸지 않는다. 플레이그라운드는 개발 전용 유지.
- `mocap-local/` 건드리지 않기.
