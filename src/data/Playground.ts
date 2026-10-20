export const PLAYGROUND_SCENARIOS = [
  { id: 'passing', label: '패스 궤적', hint: '수비 없이 15m 앞 동료에게 패스해요. 높이·속도·받을 위치를 비교해 봐요.' },
  { id: 'commands', label: '패스 커맨드', hint: '15m 앞에 동료, 4m 앞에 수비수가 있어요. S·SS·W·WW·Q+S·Z+Q+W를 비교해 봐요.' },
  { id: 'cross', label: '측면 크로스', hint: '상대 박스 옆에서 A·AA·Q+A·C+A·Z+A를 비교해 봐요.' },
  { id: 'contact', label: '수비 몸싸움', hint: '공을 가진 상대 옆에서 Space 길게 누르기·D 밀치기·C+방향·C+E를 해 봐요.' },
  { id: 'clearance', label: '루즈볼 걷어내기', hint: '가까운 루즈볼을 D로 높고 멀리 걷어내요.' },
  { id: 'free', label: '자유 드리블', hint: '공격수로 공을 몰아요. 방향키·E로 드리블과 급회전을 해 봐요.' },
  { id: 'duel', label: '1대1 압박', hint: '앞의 수비수 한 명이 압박해요. 개인기로 따돌려 봐요.' },
  { id: 'pressure', label: '3명 압박', hint: '세 방향에서 다가오는 상대를 피해 드리블해 봐요.' },
  { id: 'receive', label: '패스 받기', hint: '15m 뒤 동료가 땅볼 패스를 해요. 방향키를 누른 채 받아 봐요.' },
  { id: 'slide', label: '슬라이딩 태클', hint: '상대가 오른쪽에서 왼쪽으로 드리블해요. A 슬라이딩 · Space 스탠딩 태클 · V 카메라 전환' },
  { id: 'keeper', label: '키퍼 1대1 / 슛', hint: '골문 22m 앞에서 시작해요. D 슛 · Z+D 감아차기 · Q+D 칩슛' },
] as const;
export type PlaygroundScenario = typeof PLAYGROUND_SCENARIOS[number]['id'];

/** 단위·범위를 데이터로 두어 모바일 슬라이더와 기록이 같은 항목을 쓰게 한다. 각도는 라디안이다. */
export const PLAYGROUND_PARAMETERS = [
  { key: 'leadWalk', min: 0.05, max: 1.5, step: 0.01, unit: 'm' },
  { key: 'leadSprint', min: 0.1, max: 2, step: 0.01, unit: 'm' },
  { key: 'touchPeriod', min: 0.1, max: 0.8, step: 0.01, unit: 's' },
  { key: 'reach', min: 0.3, max: 1.5, step: 0.01, unit: 'm' },
  { key: 'turnReach', min: 0.3, max: 1.5, step: 0.01, unit: 'm' },
  { key: 'turnAngle', min: 0.05, max: 1.6, step: 0.01, unit: 'rad' },
  { key: 'turnMin', min: 0.1, max: Math.PI, step: 0.01, unit: 'rad' },
  { key: 'turnMax', min: 0.1, max: Math.PI, step: 0.01, unit: 'rad' },
  { key: 'turnSlowdown', min: 0, max: 0.9, step: 0.01, unit: '' },
  { key: 'pressureRange', min: 0.5, max: 8, step: 0.1, unit: 'm' },
  { key: 'pressureKnock', min: 0.05, max: 1, step: 0.01, unit: '' },
  { key: 'windup', min: 0, max: 0.5, step: 0.01, unit: 's' },
] as const;
