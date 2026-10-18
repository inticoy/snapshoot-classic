# Mixamo에서 받아 올 것

선수 모델과 동작을 Mixamo로 바꾸기 위한 장보기 목록이에요.
받은 파일은 저장소 밖 `mocap-local/mixamo/`(gitignore)에 두면, 변환해서 게임에 넣는 건 제가 할게요.

- 사이트: https://www.mixamo.com (Adobe 계정으로 무료 로그인)
- 라이선스: 게임에 넣어 배포해도 됨(로열티 없음). 원본 파일을 그대로 재배포하는 것만 안 됨
- 동작 이름은 사이트에서 바뀌기도 해서 **검색어**로 적었어요. 검색 결과에서 가장 비슷한 걸 고르면 돼요

## 1. 캐릭터 1개
**Characters** 탭에서 운동복 차림의 사람형 캐릭터 하나를 고르세요. 유니폼 색은 게임에서 다시 칠해요.
- 고르는 기준: 반팔·반바지, 팔다리 비율이 보통, 얼굴이 너무 만화풍이 아닌 것
- 받기 설정: Format **FBX Binary(.fbx)**, Pose **T-pose**

## 2. 동작
동작 받기 설정(모두 같게):
- Format **FBX Binary**, Skin **Without Skin**, Frames per second **30**, Keyframe Reduction **none**
- **In Place** 체크 칸이 있으면 체크 (달리기·드리블처럼 앞으로 나아가는 동작)
- 위에서 고른 캐릭터를 선택한 상태로 받기 (뼈 이름이 맞게)

| 우선 | 검색어 | 쓰는 곳 |
| --- | --- | --- |
| 1 | `soccer idle` / `goalkeeper idle` | 서 있기, 키퍼 대기 |
| 1 | `jog` · `run` · `sprint` (In Place) | 이동 |
| 1 | `soccer dribble` 또는 `dribble` (In Place) | 드리블 |
| 1 | `soccer pass` · `kick` · `soccer kick` | 패스, 슛 |
| 1 | `header` / `soccer header` | 헤더 |
| 1 | `soccer tackle` · `slide tackle` | 태클 |
| 1 | `goalkeeper catch` · `goalkeeper diving save` · `goalkeeper drop kick` · `goalkeeper throw` | 키퍼 |
| 2 | `chip` · `penalty kick` · `volley` | 칩슛, PK, 발리 |
| 2 | `trip` · `fall` · `get up` | 넘어짐, 일어나기 |
| 2 | `celebration` · `fist pump` · `knee slide` | 골 세리머니 |
| 2 | `turn` · `stop` · `strafe` | 방향 전환, 옆걸음 |
| 3 | `step over` · `feint` · `juggling` | 개인기 (있으면) |

우선순위 1만 있어도 지금보다 크게 좋아져요. 3은 없을 가능성이 높아요. 없으면 지금처럼 다리 IK로 만들어요.
