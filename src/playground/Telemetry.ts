import { PLAYGROUND } from '../config';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export interface TelemetrySample {
  time: number;
  dt: number;
  controlled: string;
  input: Vec2;
  playerVelocity: Vec3;
  facing: Vec2;
  ballVelocity: Vec3;
  footDistance: number;
  owned: boolean;
  intentionalKick: boolean;
  touches: number;
  heavyTouches: number;
  motionId: string | null;
  hipsHeight: number | null;
}

export interface TelemetryState {
  previous: TelemetrySample | null;
  /** 아날로그 입력의 작은 변화가 누적되더라도 마지막 목표 방향을 기준으로 감지한다. */
  target: Vec2 | null;
  turnStarted: number | null;
  lastTurnSeconds: number | null;
  touchTimes: number[];
  heavyTouches: number;
  losses: number;
  /** 입력이 비어 있던 시간 (초) */
  idle?: number;
}
export interface TelemetryMetrics {
  time: number;
  playerSpeed: number;
  ballSpeed: number;
  footDistance: number;
  bodyInputAngle: number | null;
  ballInputAngle: number | null;
  touchesPerSecond: number;
  lastTurnSeconds: number | null;
  turnPending: boolean;
  heavyTouches: number;
  losses: number;
  motionId: string | null;
  hipsHeight: number | null;
}

export function initialTelemetry(): TelemetryState {
  return { previous: null, target: null, turnStarted: null, lastTurnSeconds: null, touchTimes: [], heavyTouches: 0, losses: 0, idle: 0 };
}

/** 정지 벡터에는 방향이 없으므로 0° 대신 null을 반환한다. 출력 단위는 도다. */
export function directionAngle(a: Vec2, b: Vec2): number | null {
  const lengths = Math.hypot(...a) * Math.hypot(...b);
  if (lengths < 1e-10) return null;
  return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / lengths))) * 180 / Math.PI;
}

/** DOM·Three·벽시계와 독립적인 리듀서. time은 스텝 끝, 입력 변화 시점은 그 스텝 시작이다. */
export function updateTelemetry(state: TelemetryState, sample: TelemetrySample): { state: TelemetryState; metrics: TelemetryMetrics } {
  const changedPlayer = state.previous?.controlled !== sample.controlled;
  const active = Math.hypot(...sample.input) > PLAYGROUND.inputDeadzone;
  let target = changedPlayer ? null : state.target;
  let turnStarted = changedPlayer ? null : state.turnStarted;
  let lastTurnSeconds = changedPlayer ? null : state.lastTurnSeconds;
  // 키를 바꿔 누르는 사이 한두 스텝 입력이 비는 것은 같은 조작으로 본다 (↑ 떼고 → 누르기 = 90° 전환)
  const idle = active ? 0 : (state.idle ?? 0) + sample.dt;
  if (!active) {
    if (idle > 0.15) {
      target = null;
      turnStarted = null;
    }
  } else if (!target) {
    target = sample.input;
  } else if ((directionAngle(target, sample.input) ?? 0) >= PLAYGROUND.turnThreshold * 180 / Math.PI) {
    target = sample.input;
    // 새 목표가 오면 완료되지 않은 이전 전환을 새 입력 시점부터 잰다.
    turnStarted = Math.max(0, sample.time - sample.dt);
  }
  const horizontalBallSpeed = Math.hypot(sample.ballVelocity[0], sample.ballVelocity[2]);
  const bodyInputAngle = active ? directionAngle(sample.facing, sample.input) : null;
  const ballInputAngle = active && horizontalBallSpeed >= PLAYGROUND.minBallSpeed
    ? directionAngle([sample.ballVelocity[0], sample.ballVelocity[2]], sample.input) : null;
  if (turnStarted !== null && ballInputAngle !== null && ballInputAngle <= PLAYGROUND.turnThreshold * 180 / Math.PI + 1e-8) {
    lastTurnSeconds = sample.time - turnStarted;
    turnStarted = null;
  }
  const touchTimes = state.touchTimes.filter((t) => t > sample.time - PLAYGROUND.touchWindow);
  for (let i = 0; i < sample.touches; i++) touchTimes.push(sample.time);
  const heavyTouches = state.heavyTouches + sample.heavyTouches;
  // 슛·패스에 따른 의도적 방출과 조작 선수 전환은 소유 상실로 세지 않는다.
  const losses = state.losses + (!changedPlayer && state.previous?.owned && !sample.owned && !sample.intentionalKick ? 1 : 0);
  return {
    state: { previous: sample, target, turnStarted, lastTurnSeconds, touchTimes, heavyTouches, losses, idle },
    metrics: {
      time: sample.time, playerSpeed: Math.hypot(...sample.playerVelocity), ballSpeed: Math.hypot(...sample.ballVelocity),
      footDistance: sample.footDistance, bodyInputAngle, ballInputAngle,
      touchesPerSecond: touchTimes.length / PLAYGROUND.touchWindow, lastTurnSeconds, turnPending: active && turnStarted !== null,
      heavyTouches, losses, motionId: sample.motionId, hipsHeight: sample.hipsHeight,
    },
  };
}

export function recentHistory<T extends { time: number }>(history: readonly T[], time: number): T[] {
  return history.filter((row) => row.time >= time - PLAYGROUND.historySeconds);
}

/** 중첩 입력·상태도 한 셀에 JSON으로 보존하고 RFC 4180 방식으로 인용한다. */
export function recordsToCsv(rows: readonly Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (v: unknown) => `"${(v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/"/g, '""')}"`;
  return [columns.map(cell).join(','), ...rows.map((row) => columns.map((key) => cell(row[key])).join(','))].join('\r\n');
}
