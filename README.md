# Football Game (가칭)

브라우저에서 키보드로 하는 3D 3대3 축구 게임. Three.js + cannon-es + Vite + TypeScript.

## 실행

```bash
pnpm install
pnpm dev        # http://localhost:5180
pnpm build      # dist/ 에 정적 파일 생성 (GitHub Pages 등에 그대로 배포 가능)
```

## 조작 (FC 온라인 키보드 기본 배치 기준)

| 공격 | | 수비 | |
|---|---|---|---|
| 방향키 | 이동 | D (꾹) | 압박 |
| E | 질주 | Q (꾹) | 동료 압박 |
| D (꾹 → 떼기) | 슛 (80% 넘기면 뜸) | C (꾹) | 견제 |
| Z + D | 감아차기 | Space | 스탠딩 태클 |
| Q + D | 칩슛 | A | 슬라이딩 태클 |
| S | 짧은 패스 | S | 선수 변경 |
| W | 스루 패스 | | |
| Q + W | 로빙 스루 패스 | | |
| A | 로빙 패스 | | |

Esc 일시정지 · V 카메라 · M 사운드. 공이 오는 중에 슛/패스를 미리 누르면 원터치로 처리된다.

세트피스(스로인 · 코너킥 · 골킥): 방향키로 조준, S 짧게 / A 길게 (꾹 눌러 세기).

설정에서 **패스 보조 / 슛 보조**를 보조 · 세미 · 수동으로 바꿀 수 있다. 정확도와 세기는 선수 능력치에 따라 달라진다.

남은 작업은 [docs/CHECKLIST.md](docs/CHECKLIST.md) 참고.

## 구조

```
src/
  config.ts              모든 튜닝 값 (경기장 크기, 공 물리, 선수 속도, AI)
  core/Game.ts           렌더러, 고정 스텝 루프(120Hz), 이벤트 → 사운드/HUD
  core/Input.ts          키보드 상태 + 눌림/뗌 엣지
  physics/PhysicsWorld.ts  cannon-es 월드, 재질별 반발/마찰
  entities/Ball.ts       공: 공기저항, 마그누스 효과, 구름 저항, 드리블 carry
  entities/Player.ts     선수: 관성 있는 이동, 스태미나, 태클/다이빙 상태
  entities/SkinnedPlayerModel.ts  스킨드 캐릭터: 이동 클립 블렌딩 + 킥/태클/다이빙 뼈 오버레이 + 유니폼 셰이더
  entities/PlayerModel.ts  절차적 휴머노이드 (캐릭터 로드 실패 시 대체)
  data/Teams.ts          가상의 팀/선수 데이터 (이름, 등번호, OVR, 주발, 개인기)
  entities/Goal.ts       골대 충돌체 + 출렁이는 그물
  environment/Stadium.ts 잔디/라인(캔버스 텍스처), 광고판, 관중(InstancedMesh), 조명탑
  gameplay/Match.ts      경기 규칙, 소유권, 슛/패스/태클, 키퍼 선방, 골 판정
  ai/TeamAI.ts           필드 플레이어 AI (소유자/압박/서포트 역할)
  camera/CameraRig.ts    중계 / 선수 뒤 카메라
  ui/Hud.ts              FC 스타일 HUD: 스코어보드, 인디케이터, 파워 게이지, 하단 선수 이름 바, 레이더, 골 자막
  ui/Menu.ts             메인 메뉴 / 일시정지(경기 기록) / 경기 결과
  audio/Sound.ts         WebAudio 효과음 + 합성 휘슬
```

선수는 물리 엔진이 아니라 코드로 직접 움직이고(키네마틱), 공만 물리 엔진에 맡긴다.
조작감 튜닝이 쉬워지고, 대부분의 축구 게임이 쓰는 방식이다.

## 에셋

- 공 모델, 효과음: [snapshoot](https://github.com/inticoy/snapshoot)
- 선수 캐릭터와 애니메이션: [Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) (CC0).
  필요한 클립 7개만 남기고 meshopt로 압축 (4.9MB → 295KB). 킥/태클/다이빙은 라이브러리에 없어서 코드로 덧입힌다.

## 다음 단계 아이디어

- 킥/태클/헤더 전용 모션 캡처 클립 (Mixamo 등에서 받아 같은 리그로 리타겟)
- 5대5 → 11대11, 포메이션, 오프사이드
- 로빙 패스, 스루 패스, 칩슛
- 난이도 설정, 게임패드 지원
