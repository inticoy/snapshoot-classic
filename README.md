# SnapShoot Classic

[SnapShoot](https://github.com/inticoy/snapshoot)(스와이프 승부차기)의 클래식 모드. 브라우저에서 키보드·터치로 하는 3D 11대11 축구. 105×68m 경기장과 4-3-3 포메이션.

**플레이:** https://inticoy.github.io/snapshoot-classic/

Three.js + cannon-es + Vite + TypeScript.

## 실행

```bash
pnpm install
pnpm dev        # http://localhost:5180
pnpm typecheck  # 게임·테스트 타입 검사
pnpm test       # 브라우저 없이 고정 시드 경기/물리 회귀 검증
pnpm build      # dist/ 에 정적 파일 생성 (GitHub Pages 등에 그대로 배포 가능)
```

## 자동 검증

`pnpm typecheck && pnpm test && pnpm build`로 전체 회귀 검증을 실행한다.
배포 워크플로도 빌드 전에 타입 검사와 테스트를 실행하며, 실패하면 배포하지 않는다.

테스트는 실제 `Match.update`와 cannon-es 물리를 사용한다. `Match` 생성 옵션으로
선수 모델 팩토리(`createPlayerModel`)와 `new Random(seed)`를 주입할 수 있다.
`goalVisuals: false`는 골망 시각 갱신만 생략하고 충돌체를 유지하며,
`userControl: false`는 양 팀을 AI로 진행한다. 기본 옵션은 브라우저 게임 동작을 유지한다.
재현하려면 같은 시드·입력·고정 스텝(`PHYSICS.step`)·보조 설정·물리 프리셋을 사용한다.
보조 설정과 활성 물리 프리셋은 기존처럼 모듈 전역이므로 서로 다른 설정의 경기를
같은 프로세스에서 동시에 검증할 때는 격리가 필요하다.

브라우저 확인은 `pnpm dev` 실행 후 별도 터미널에서 `pnpm test:browser`를 실행한다.
macOS에서는 Playwright 캐시의 Chrome for Testing 경로를 자동으로 찾으며,
필요하면 `CHROMIUM_PATH`로 실행 파일을 지정한다. 메뉴 → 경기 시작 → 일시정지/재개 →
D 키 슛 → 득점을 검사하고 `.artifacts/browser-smoke/`에 캡처를 남긴다.
득점 검증에는 고정 시드와 골문 앞 선수 배치를 사용한다.
`pnpm test:browser --update-og`로 실제 경기 화면의 공유 이미지도 다시 생성할 수 있다.

수치와 브라우저 확인 상태는 [0단계 검증 기록](docs/roadmap/phase-0-validation.md)에 정리한다.

2단계 화면·성능 검증은 `pnpm test:phase2`로 실행한다. 중계 화면·전체 경기장·네 코너 확대를
`.artifacts/phase-2/`에 저장하고, 스킨드 캐릭터 22명의 10초 프레임 측정 결과를 JSON으로 기록한다.
현재 환경의 실행 제한과 자동 검증 수치는 [2단계 검증 기록](docs/roadmap/phase-2-validation.md)을 참고한다.

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
- 포메이션 선택, 전술 설정, 오프사이드
- 로빙 패스, 스루 패스, 칩슛
- 난이도 설정, 게임패드 지원
