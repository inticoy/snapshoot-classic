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

## 배포
중계 서버: https://snapshoot-relay.woojoo.workers.dev (게임 기본값). 다시 올리기: `cd server && CLOUDFLARE_API_TOKEN=… npx wrangler deploy` (Node 22).

## 화면마다 달라질 수 있는 것 (모두 맞춰 둠)
| 항목 | 처리 |
|---|---|
| 패스·슛·이동 보정 | 각자 자기 팀에만 적용 (시작 신호로 서로의 설정을 받는다) |
| 경기 시간·승부차기·물리 프리셋 | 방장(팀 0) 설정을 양쪽에 |
| 일시정지(Esc) | 메뉴만 뜨고 경기는 계속 (내 선수는 입력 없음). 메뉴: 계속하기 / 경기 나가기 |
| 하프타임 | 메뉴로 멈추지 않고 안내만, 정해진 시간 뒤 자동 후반 |
| 경기 종료 | 다시 하기 없음 (한쪽만 재시작하면 갈라짐) → 새 방 만들기 / 메인 메뉴 |
| UI로 게이지 취소 | 온라인에서는 안 함 (입력 기록 밖 변경) |
| 탭 전환 | 상대 화면에 '화면을 벗어났어요' (돌아올 때까지 경기는 멈춤) |
| 연결 끊김 | '상대 연결이 끊겼어요' → 같은 링크로 다시 들어오면 기록을 빠르게 재생해 따라잡는다 |
| 상대 입력 지연 | 0.5초 넘게 기다리면 '상대 입력을 기다리는 중' |

확인: `node scripts/online-flow-smoke.mjs` (설정이 다른 두 사람, 일시정지 중 진행, 재접속 따라잡기)

## 남은 것
- 롤백(지연 없이 반응): 킥 준비(`windups`)가 함수로 저장돼 상태 저장이 안 된다 → 데이터로 바꾼 뒤
- Firefox: Playwright Firefox가 이 macOS에서 실행되지 않아 미검증
- 매칭 대기열(코드 없이 빠른 상대 찾기)
- HUD·이름 바가 팀 1 화면에서 맞는지 확인
