# Football Game (가칭)

브라우저에서 키보드로 하는 3D 3대3 축구 게임. Three.js + cannon-es + Vite + TypeScript.

## 실행

```bash
pnpm install
pnpm dev        # http://localhost:5180
pnpm build      # dist/ 에 정적 파일 생성 (GitHub Pages 등에 그대로 배포 가능)
```

## 조작

| 키 | 동작 |
|---|---|
| WASD / 방향키 | 이동 (카메라 기준) |
| Shift | 스프린트 (스태미나 소모) |
| J / Space 꾹 → 떼기 | 슛. 오래 누를수록 강하고, 80% 넘기면 뜬다 |
| L 꾹 → 떼기 | 감아차기 (마그누스 효과로 먼 쪽 포스트로 휘어 들어감) |
| K | 방향키 쪽 동료에게 패스 (받는 선수로 자동 전환) |
| J (공 없을 때) | 슬라이딩 태클 |
| Q / K (수비 시) | 공에 가장 가까운 선수로 전환 |
| C | 중계 카메라 ↔ 선수 뒤 카메라 |
| P / Esc | 일시정지 |
| M | 소리 끄기 |

## 구조

```
src/
  config.ts              모든 튜닝 값 (경기장 크기, 공 물리, 선수 속도, AI)
  core/Game.ts           렌더러, 고정 스텝 루프(120Hz), 이벤트 → 사운드/HUD
  core/Input.ts          키보드 상태 + 눌림/뗌 엣지
  physics/PhysicsWorld.ts  cannon-es 월드, 재질별 반발/마찰
  entities/Ball.ts       공: 공기저항, 마그누스 효과, 구름 저항, 드리블 carry
  entities/Player.ts     선수: 관성 있는 이동, 스태미나, 태클/다이빙 상태
  entities/PlayerModel.ts  절차적 휴머노이드 + 포즈 블렌딩(크로스페이드) 애니메이션
  entities/Goal.ts       골대 충돌체 + 출렁이는 그물
  environment/Stadium.ts 잔디/라인(캔버스 텍스처), 광고판, 관중(InstancedMesh), 조명탑
  gameplay/Match.ts      경기 규칙, 소유권, 슛/패스/태클, 키퍼 선방, 골 판정
  ai/TeamAI.ts           필드 플레이어 AI (소유자/압박/서포트 역할)
  camera/CameraRig.ts    중계 / 선수 뒤 카메라
  ui/Hud.ts              스코어보드, 파워 게이지, 미니맵
  audio/Sound.ts         WebAudio 효과음 + 합성 휘슬
```

선수는 물리 엔진이 아니라 코드로 직접 움직이고(키네마틱), 공만 물리 엔진에 맡긴다.
조작감 튜닝이 쉬워지고, 대부분의 축구 게임이 쓰는 방식이다.

에셋(공 모델, 효과음)은 [snapshoot](https://github.com/inticoy/snapshoot)에서 가져왔다.

## 다음 단계 아이디어

- Mixamo 캐릭터 + `AnimationMixer` 로 교체 (PlayerModel의 상태 머신 인터페이스 유지)
- 스로인/코너킥/골킥 (지금은 광고판에 튕기는 아레나 방식)
- 5대5 → 11대11, 포메이션, 오프사이드
- 로빙 패스, 스루 패스, 칩슛
- 난이도 설정, 게임패드 지원
