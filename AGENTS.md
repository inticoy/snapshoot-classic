# SnapShoot Classic — 작업 가이드 (Codex/에이전트용)

브라우저 3D 축구 게임. Vite + TypeScript + Three.js + cannon-es. 공개 배포: main 푸시 시 GitHub Pages 자동 배포.

## 반드시 지킬 것
- **브라우저를 띄우지 말 것.** Chrome·Playwright·dev 서버(`pnpm dev`, `vite`) 실행 금지 — 사용자 컴퓨터가 크래시난다. 화면 확인은 리뷰하는 쪽(Claude)이 한다. 검증은 vitest·tsc·build로만.
- **git push 금지.** 커밋만 한다 (푸시는 사람이 검토 후). `git commit` 메시지 끝에 `Co-Authored-By: Codex <noreply@openai.com>` 한 줄.
- 기존 코드 스타일을 따른다: 한국어 주석(왜 그런지 설명), 상수는 `src/config.ts`, 물리 값은 `src/physics/presets.ts`, 데이터는 `src/data/`.
- FC 온라인 키보드 배치(`src/core/Input.ts` 주석)와 보정 옵션(`src/core/Settings.ts`) 동작을 깨지 않는다.
- 실존 선수/팀/EA 상표·로고를 쓰지 않는다 (가상 이름만).
- 단계가 끝나면 아래 검증을 모두 통과해야 한다. 실패하면 고친다.

## 검증
```bash
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest (0단계에서 추가)
pnpm build
```
브라우저 확인은 하지 않는다 (위 금지 사항). 시각 결과가 중요한 작업이면 무엇을 봐야 하는지 보고에 적는다.

## 구조 요약
- `src/gameplay/Match.ts` 경기 진행·소유권·태클·키퍼·공중볼, `Kicks.ts` 슛/패스 궤적(능력치·보정), `SetPieces.ts` 아웃·스로인·코너·골킥
- `src/ai/TeamAI.ts` 필드 AI (포메이션 이동, 대인 마크, 공 소유 시 판단)
- `src/data/Formation.ts` 포메이션 슬롯, `Teams.ts` 선수 데이터, `Stats.ts` 능력치
- `src/entities/` 공·선수·골대·스킨드 캐릭터, `src/ui/` HUD·메뉴, `src/core/Game.ts` 루프·이벤트
- 남은 작업: `docs/CHECKLIST.md`, 단계별 지시서: `docs/roadmap/`
