# 온라인 1:1 (입력 지연 락스텝)

## 구조
- **클라이언트**: 두 사람이 같은 시드로 같은 경기를 각자 계산한다. 주고받는 것은 틱별 입력(6바이트)뿐.
  - `src/net/CommandCodec.ts` 입력 ↔ 6바이트
  - `src/net/Lockstep.ts` 내 입력을 delay틱 뒤로 예약해 보내고, 두 팀 입력이 다 온 틱만 계산. 1초마다 상태 해시 교환
  - `src/net/Replay.ts` 입력 기록·재생·상태 해시 (재접속 = 처음부터 재생)
  - `src/net/DetMath.ts` 엔진마다 다른 Math 함수를 결정적 구현으로 교체 (없으면 Chromium·WebKit이 31초째 어긋남)
  - `src/net/NetSession.ts` 중계 서버 WebSocket
- **중계 서버** (`server/`, Cloudflare Workers + Durable Objects): 방 만들기, 두 사람의 왕복 시간으로 입력 지연 결정, 입력 중계·기록, 해시 비교, 재접속 시 기록 재전송. 경기 계산은 하지 않는다.

## 로컬에서 해 보기
```bash
cd server && npm install && PATH=~/.nvm/versions/node/v22.23.1/bin:$PATH npx wrangler dev --port 8787   # 중계 서버
pnpm dev                                                                                               # 게임
```
- 방 만들기: `http://localhost:5180/?online` → 주소가 `?room=코드`로 바뀐다. 같은 주소를 다른 창(또는 다른 기기)에서 열면 시작.
- 다른 중계 서버: `&relay=https://…`
- 확인: `SNAPSHOOT_URL=… node scripts/online-smoke.mjs` (Chromium 두 개), `SECOND=webkit …` (Chromium 대 WebKit), `node scripts/determinism-check.mjs 300` (엔진별 5분 해시)

## 배포 (아직 안 함)
`cd server && npx wrangler deploy` → 나온 주소를 게임 기본 relay로 넣는다. Cloudflare 계정에 Worker·Durable Object가 생긴다.

## 남은 것
- 롤백(지연 없이 반응): 킥 준비(`windups`)가 함수로 저장돼 상태 저장이 안 된다 → 데이터로 바꾼 뒤
- Firefox: Playwright Firefox가 이 macOS에서 실행되지 않아 미검증
- 로비 UI(방 코드 입력·복사), 끊김 처리 UI, 재접속 테스트(브라우저), 매칭 대기열
- HUD·이름 바가 팀 1 화면에서 맞는지 확인
