# FC 온라인 / FIFA 메커니즘 조사 (2026-10-17)

신뢰도: **공식** = EA/넥슨 발표, **측정** = 실측·실험, **추정** = 커뮤니티 설명이나 우리 추론.
결론부터 말하면 FC/FIFA 엔진의 내부 수치(능력치→m/s, 게이지→km/h, 항력 계수)는 공개된 적이 없고, 데이터마이닝 자료도 찾지 못했다. 그래서 실제 축구 측정치를 기준으로 삼고, 정성 규칙은 EA 공식 문서로 보완했다.

## 접근 실패 / 미확인
- namu.wiki `FC 온라인/능력치` 404, EA `fifa-12-attributes-guide-02` 404
- 인벤 fifaonline4 메인을 훑었지만 스탯 실험 글은 없었다. 스피드스터 글(https://www.inven.co.kr/board/fifaonline4/3145/58983)은 정성 설명뿐이고 수치가 없다.
- 미국 검색엔진이라 한국어 검색 결과가 빈약했다. 패스 게이지→공 속도, 공 항력·스핀 값은 **출처를 찾지 못했다**.

## 1. 능력치 효과
| 항목 | FC/FIFA 근거(수치) | 출처 | 우리 현재 값 | 제안 |
|---|---|---|---|---|
| 속력(최고속) | 게임 내 m/s 환산은 미공개. 실측 최고속: 월드컵 상위 4팀 평균 최대 8.34 m/s(측정), EPL 최고 35.32 km/h = 9.8 m/s(측정) | goal.com https://www.goal.com/en-za/news/who-is-the-fastest-player-on-fifa-20/1qwf0zyh3qs6j13x6w4v59n351 , 검색 요약(원문 PDF 미확인) https://wnus.usz.edu.pl/cejssm/file/article/download/5593.pdf | `PLAYER.sprintSpeed 7.9`, `jogSpeed 5.6` (src/config.ts:50-51) | 99 속력 ≈ 9.5 m/s, 50 ≈ 7.5 m/s 정도로 범위를 넓히자(추정). 8.34 m/s 평균은 7.9 기준과 맞는다 |
| 가속력 + 가속 타입 | FC24 AcceleRATE: 가속·민첩·몸싸움·키로 Explosive/Controlled/Lengthy를 나눔. 예: Explosive = 키 ≤175cm, 민첩·가속 ≥80, 민첩−몸싸움 ≥20 / Lengthy = 키 ≥188cm, 몸싸움 ≥80, 가속 ≥55, 차이 ≥20 (공식) | https://www.ea.com/games/ea-sports-fc/news/fc-24-gameplay-deepdive , https://fut.gg/ea-sports-fc/accelerate/ | `PLAYER.accel 16`(config.ts:53) 단일값 | 타입 3종을 도입하자. Explosive는 초반 가속이 크고 최고속 도달이 이르다. Lengthy는 초반이 느리고 후반이 길다(정성은 공식, 곡선 수치는 추정) |
| 스피드스터 특성 / 아날로그 질주 | FC온라인에는 '전력질주 조절'이 있다. 스피드스터 특성이 상향됐다는 언급만 있고 수치는 없다 | https://www.inven.co.kr/board/fifaonline4/3145/58983 (추정) | 없음 | 낮은 우선순위 |
| 드리블·볼컨트롤·민첩·밸런스·슛·패스 등 | 개별 수치 근거는 찾지 못했다. 정성 정의(골결=정확도, 슛파워=속도, 중거리=박스 밖 정확도)는 우리 Stats.ts 주석과 같다 | 미확인 | src/data/Stats.ts:1-6, Kicks.ts:97-105 | 현재 구조를 유지하자 |

## 2. 패스/슛 파워
| 항목 | 근거 | 출처 | 우리 값 | 제안 |
|---|---|---|---|---|
| 강슛 상한 | 실측: 2022 월드컵 최강 슈팅 121.69 km/h = 33.8 m/s (공 내장 센서, 측정) | https://inside.fifa.com/news/luis-chavez-tops-latest-most-powerful-fifa-world-cup-goal-ranking | `SHOT.maxSpeed 31` × power(0.86~1.10) = 26.7~34.1 m/s (config.ts:91, Kicks.ts:105) | 99 슛파워가 대회 최고 기록에 해당한다. 평균 선수의 풀파워를 28~30 m/s로 두는 현 구조는 타당하다 |
| 감아차기 / 칩 / 스루 / 로빙 속도 | 게이지 대비 km/h 공식 자료 없음 | 미확인 | finesse 13~22, `finesseSpin 34`(config.ts:93-95), 패스 8~22(config.ts:99-100) | 플레이 테스트로 맞추자 |
| 보조 / 수동 | 우리 코드에는 assisted/semi/manual 구분이 있다 | — | Kicks.ts:176, 214-215 | 유지 |

## 3. 공 물리
| 항목 | 근거 | 출처 | 우리 값 | 제안 |
|---|---|---|---|---|
| 항력·마그누스·반발·구름 | FIFA 게임의 실제 값은 미공개. 우리는 이미 논문과 FIFA 공 규격 시험(2m 낙하 시 0.6~1.0m 반발)을 쓰고 있다 | 주석 출처(presets.ts:48-61) | Cd 0.45→0.22 @11.5 m/s, liftMax 0.32, rollDecel 0.9, restitution 0.72 (src/physics/presets.ts:50-63) | 실측 기반으로 유지하자. 게임 감각 보정은 ARCADE 프리셋에서만 하자 |
| 드리블 중 공 구름 | — | — | `DRIBBLE.rollDecel 1.6`(config.ts:163) vs REAL 0.9 | 의도된 값인지 확인하자(드리블 터치만 더 끈적함) |

## 4. 키보드 조작 (나무위키 FC 온라인/조작법, https://namu.wiki/w/FC%20온라인/조작법 — 커뮤니티)
| 입력 | 의미 | 우리 구현 | 제안 |
|---|---|---|---|
| Z+S | 드라이브 땅볼 패스 / 박스 근처 컷인 패스 | 미확인 | 빠르고 낮은 패스를 추가하자(속도 ×1.25 추정) |
| Z+A | 낮은 로빙 패스 | 미확인 | lob의 T를 줄인 변형 |
| Z+W | 드라이브 스루패스 | 미확인 | through + 속도 상향 |
| Z+D | 감아차기 | 있음(finesse) | — |
| Q+D | 칩슛 | 있음(Kicks.ts:148-162) | — |
| E 연타 | 퀵 녹온 드리블 | 미확인 | 추가 검토 |
| C+S / C+A / C+D | 플레어 패스·크로스·슛 | 없음 | 낮은 우선순위 |
| Z+C+D | 페이크 슛 / 노룩 슛 | 없음 | 페이크(슛 동작 취소)는 효과가 커서 추천 |
| Shift+방향 | 수동 선수 전환 | 미확인 | — |
| A/D 후 S 페이크 | 출처를 찾지 못했다 | — | — |

## 5. 개인기
| 기술 | 등급·입력(FC온라인, 인벤글로벌 가이드) | 출처 |
|---|---|---|
| 넛메그 | ★, Z+X+방향 | https://www.invenglobal.com/articles/24086/practical-skill-moves-for-beginners-to-break-down-opponent-defenses |
| 드래그백 | ★★, ↓+Z | 동일 |
| 힐 플릭 | ★★★, Shift+↑↓ | 동일 |
| 플레어 넛메그 | ★★★★★, Z+C+방향 | 동일 |

등급 게이트(선수 개인기 별 ≥ 기술 등급일 때만 발동)는 FIFA 계열 공통 규칙으로 알려져 있지만 이번에 공식 원문은 확인하지 못했다(추정). 타이밍 윈도우 수치도 찾지 못했다.
