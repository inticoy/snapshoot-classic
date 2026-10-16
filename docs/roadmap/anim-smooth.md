# 애니메이션 끊김 줄이기 (지시서)

## 증상
사용자 체감: 동작이 "뚝뚝" 끊긴다. 의심 원인 (확인 후 고칠 것):
1. 동작 전환: `SkinnedPlayerModel.playMotion` 이 이전 동작 가중치를 그대로 이어받고, 이동 클립(idle/jog/sprint)과의 섞임이 짧다 (`fadeOut 0.18`, 시작 0.08초). 킥 → 달리기, 태클 → 일어나기 → 달리기 전환이 튈 수 있다.
2. 이동 클립 가중치 전환(`updateClipWeights`): 속도 경계에서 걷기/조깅/질주가 급히 바뀌는지, 발 위상이 맞는지(같은 정규화 시간으로 동기화하는지).
3. 몸 방향: 물리 `facing` 이 급히 돌면 `syncVisual` 에서 `root.rotation.y` 가 그대로 튄다 → 화면용 yaw를 따로 두고 각속도 제한/스무딩 (물리·판정은 그대로).
4. 멀리 있는 선수 30Hz 갱신 (`VISUAL.animationHz`, `Player.syncVisual`): 끊겨 보이면 거리 기준/주기 조정.
5. 오래된 뼈 이름 버그: `rotateBone` 이 'DEF-thigh.L' 처럼 점이 있는 이름을 쓰지만 GLTFLoader가 점을 지워('DEF-thighL') 팔다리 오버레이가 동작하지 않는다 (`SkinnedPlayerModel.ts` 327줄 주석). 예전에 이름만 고쳤더니 슬라이딩 자세가 깨졌다 → 구운 동작(motion)이 재생 중일 때는 같은 부위 오버레이를 0으로 두고 이름을 바로잡는다. 오버레이가 필요 없어진 동작은 정리.

## 측정부터 (먼저 지표를 만들고 전/후 비교)
- `tests/anim-smooth.test.ts`: 실제 `public/assets/models/player.glb` 를 node에서 로드(기존 `tests/motion.test.ts` 방식 참고)해 `SkinnedPlayerModel` 을 60Hz로 업데이트하며 시퀀스를 돌린다:
  idle→질주, 질주→정지, 질주 중 180° 방향 전환, 달리며 슛(킥 동작)→다시 달리기, 슬라이딩→일어나기→달리기, 세리머니→킥오프.
- 지표: 주요 뼈(hips, spine, thigh, shin, upper_arm, forearm)의 **프레임당 회전 변화량의 2차 차분(각가속도) 최댓값**과 root yaw 프레임당 변화 최댓값. 전환 순간 스파이크가 목표.
- 수정 전 값을 기록하고, 수정 후 각 시퀀스 스파이크를 크게(목표 50% 이상) 줄인다. 테스트에는 수정 후 값보다 약간 여유 있는 상한을 둔다.

## 완료 조건
- 위 테스트 + 기존 테스트 전부 통과, `pnpm typecheck && pnpm test && pnpm build`. 기존 테스트 기대값 낮추지 말 것 (특히 `tests/motion.test.ts` 엉덩이 높이 = 슬라이딩이 땅에 붙어 있어야 함).
- 킥 타이밍(공이 나가는 터치 프레임)과 게임 판정은 바뀌지 않는다.
- 보고서에 시퀀스별 전/후 수치 표, 고친 원인, 남은 한계.

## 지킬 것
- AGENTS.md 규칙. 상수는 `src/config.ts` 의 `VISUAL` 등에 이유 주석과 함께. `mocap-local/` 건드리지 않기.
