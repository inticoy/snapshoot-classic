import * as THREE from 'three';
import { HeadlessModel } from '../net/HeadlessModel';
import { PHYSICS } from '../config';
import { Input, ACTION_KEYS } from '../core/Input';
import { Random } from '../core/Random';
import { PLAYGROUND_PARAMETERS, PLAYGROUND_SCENARIOS, type PlaygroundScenario } from '../data/Playground';
import type { Player } from '../entities/Player';
import { Match, type MatchEvent, type PracticeOpponent, type UserCommand } from '../gameplay/Match';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlaygroundScenarios } from './Scenarios';
import { parameterSnapshot, setParameter } from './Parameters';

export interface PlaygroundScript {
  scenario: PlaygroundScenario;
  seed: number;
  duration: number;
  params?: Record<string, number>;
  opponent?: PracticeOpponent;
  control?: 'user' | 'opponent';
  /** 조작 선수의 개인기 별 (1~5). 없으면 원래 선수 값 */
  skill?: number;
  inputs: { t: number; keys?: string[]; tap?: string[] }[];
  sampleHz?: number;
}
export interface ScriptResult {
  frames: { t: number; user: { pos: number[]; vel: number[]; facing: number[]; stunned: number; contactScale: number }; timing: { elapsed: number; timed: boolean; tapped: boolean } | null; ball: { pos: number[]; vel: number[] }; owner: string | null; footToBall: number; opponents: { pos: number[]; dist: number }[]; keys: string[] }[];
  events: { t: number; type: MatchEvent['type']; [key: string]: unknown }[];
  summary: { possession: number; progress: Record<string, number>; alignment: Record<string, number>; touches: number; losses: number; nearestOpponent: number | null; firstWithin2m: number | null; tackleAttempts: number; userTackles: number; opponentTackles: number; tackleSuccesses: number; skills: Record<string, number> };
}

const allowedKeys = new Set([...Object.values(ACTION_KEYS).flat(), 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const opponentModes = ['stand', 'follow', 'press', 'tackle'];
const vec = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
const id = (p: Player | null) => p ? `${p.profile.short} #${p.number}` : null;

/** 외부 JSON을 읽는 두 경로가 동일한 범위·키 검증을 사용한다. */
export function validateScript(value: unknown): PlaygroundScript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('스크립트는 JSON 객체여야 해요');
  const s = value as Record<string, unknown>;
  if (!PLAYGROUND_SCENARIOS.some((v) => v.id === s.scenario)) throw new Error('알 수 없는 scenario');
  if (!Number.isSafeInteger(s.seed)) throw new Error('seed는 정수여야 해요');
  if (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration <= 0 || s.duration > 3600) throw new Error('duration은 0~3600초 범위여야 해요');
  if (s.sampleHz !== undefined && (typeof s.sampleHz !== 'number' || !Number.isFinite(s.sampleHz) || s.sampleHz <= 0 || s.sampleHz > 120)) throw new Error('sampleHz는 0~120Hz 범위여야 해요');
  if (s.opponent !== undefined && !opponentModes.includes(s.opponent as string)) throw new Error('알 수 없는 opponent');
  if (s.control !== undefined && s.control !== 'user' && s.control !== 'opponent') throw new Error('알 수 없는 control');
  if (s.skill !== undefined && (!Number.isInteger(s.skill) || (s.skill as number) < 1 || (s.skill as number) > 5)) throw new Error('skill은 1~5');
  if (!Array.isArray(s.inputs)) throw new Error('inputs 배열이 필요해요');
  let previous = -1;
  for (const row of s.inputs) {
    if (!row || typeof row !== 'object' || typeof row.t !== 'number' || !Number.isFinite(row.t) || row.t < 0 || row.t > s.duration || row.t < previous) throw new Error('입력 시각은 오름차순이며 duration 이하여야 해요');
    previous = row.t;
    if (row.keys === undefined && row.tap === undefined) throw new Error('입력에는 keys 또는 tap이 필요해요');
    for (const field of ['keys', 'tap'] as const) if (row[field] !== undefined && (!Array.isArray(row[field]) || !row[field].every((k: unknown) => typeof k === 'string' && allowedKeys.has(k)))) throw new Error(`잘못된 ${field} 키`);
  }
  if (s.params !== undefined) {
    if (!s.params || typeof s.params !== 'object' || Array.isArray(s.params)) throw new Error('params는 객체여야 해요');
    for (const [key, v] of Object.entries(s.params)) {
      const p = PLAYGROUND_PARAMETERS.find((item) => key === (item.key === 'windup' ? 'MOTION_SELECT.windup' : `DRIBBLE.${item.key}`));
      if (!p || typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max) throw new Error(`잘못된 파라미터: ${key}`);
    }
  }
  if (s.control === 'opponent' && !['duel', 'pressure', 'slide', 'commands', 'contact', 'clearance'].includes(s.scenario as string)) throw new Error('상대 조작은 필드 선수가 있는 시나리오에서만 가능해요');
  return s as unknown as PlaygroundScript;
}

export function scriptCommand(input: Input): UserCommand {
  const axis = input.moveAxis();
  input.updateSkillMask(input.isDown('skill') || input.isDown('finesse'));
  const sa = input.skillAxis();
  return {
    skillMove: new THREE.Vector3(sa.y, 0, sa.x),
    // 플레이그라운드의 전진은 +X, 오른쪽은 +Z다.
    move: new THREE.Vector3(axis.y, 0, axis.x), sprint: input.isDown('sprint'),
    shoot: input.button('shoot'), pass: input.button('pass'), through: input.button('through'), lob: input.button('lob'),
    modifier: input.button('modifier'), finesse: input.button('finesse'), contain: input.button('contain'), tackle: input.button('tackle'),
    skill: input.button('skill'), power: input.button('power'), keyboardKick: input.keyboardKick(),
  };
}
function serializedEvent(event: MatchEvent, t: number): ScriptResult['events'][number] {
  const row: Record<string, unknown> = { t, type: event.type };
  for (const [key, value] of Object.entries(event)) if (key !== 'type') row[key] = value && typeof value === 'object' && 'profile' in value ? id(value as Player) : value;
  return row as ScriptResult['events'][number];
}

/** 새 Match와 고정 스텝 입력으로 매번 같은 JSON 값만 반환한다. */
export function runScript(source: PlaygroundScript): ScriptResult {
  const script = validateScript(source);
  const snapshot = parameterSnapshot();
  try {
    for (const [key, value] of Object.entries(script.params ?? {})) setParameter(key.split('.')[1] as typeof PLAYGROUND_PARAMETERS[number]['key'], value);
    const match = new Match(new PhysicsWorld(), { practice: true, random: new Random(script.seed), createPlayerModel: () => new HeadlessModel(), goalVisuals: false });
    new PlaygroundScenarios(match).reset(script.scenario, script.seed, script.opponent ?? 'press', script.control ?? 'user');
    const input = new Input({ addEventListener() {} } as unknown as Window);
    const result: ScriptResult = { frames: [], events: [], summary: { possession: 0, progress: {}, alignment: {}, touches: 0, losses: 0, nearestOpponent: null, firstWithin2m: null, tackleAttempts: 0, userTackles: 0, opponentTackles: 0, tackleSuccesses: 0, skills: {} } };
    const user = match.controlled;
    if (script.skill !== undefined) Object.defineProperty(user, 'profile', { value: { ...user.profile, skill: script.skill }, configurable: true });
    const foes = match.players.filter((p) => p.team !== user.team && !p.isKeeper);
    const summary = result.summary;
    let nearest = Infinity, held: string[] = [], rowIndex = 0, previousOwner = match.ball.owner;
    const previousTackle = new Map(match.players.map((p) => [p, p.tackleTimer]));
    const aligned = new Set<string>();
    const hz = script.sampleHz ?? 30;
    const steps = Math.ceil(script.duration / PHYSICS.step);
    const capture = (t: number, keys: string[]) => {
      const bp = match.ball.position;
      result.frames.push({ t: +t.toFixed(6), user: { pos: vec(user.pos), vel: vec(user.vel), facing: vec(user.facing), stunned: user.stunned, contactScale: user.contactScale }, timing: match.powerTiming ? { elapsed: match.powerTiming.elapsed, timed: match.powerTiming.timed, tapped: match.powerTiming.tapped } : null, ball: { pos: vec(bp), vel: vec(match.ball.velocity) }, owner: id(match.ball.owner), footToBall: match.footPoint(user, new THREE.Vector3()).distanceTo(bp), opponents: foes.map((p) => ({ pos: vec(p.pos), dist: Math.hypot(p.pos.x - user.pos.x, p.pos.z - user.pos.z) })), keys: [...keys] });
    };
    capture(0, []);
    let nextSample = 1;
    for (let step = 0; step < steps; step++) {
      const t = step * PHYSICS.step;
      const taps: string[] = [];
      while (rowIndex < script.inputs.length && script.inputs[rowIndex].t <= t + 1e-9) {
        const row = script.inputs[rowIndex++];
        if (row.keys) { held = [...row.keys]; aligned.clear(); }
        if (row.tap) taps.push(...row.tap);
      }
      const keys = [...new Set([...held, ...taps])];
      input.setVirtualKeys(keys);
      const cmd = scriptCommand(input);
      const before = user.pos.clone();
      match.update(PHYSICS.step, cmd);
      const end = (step + 1) * PHYSICS.step;
      const direction = `${Math.sign(cmd.move.x)},${Math.sign(cmd.move.z)}`;
      if (cmd.move.lengthSq() > 0) {
        summary.progress[direction] = (summary.progress[direction] ?? 0) + user.pos.clone().sub(before).dot(cmd.move);
        if (!aligned.has(direction)) {
          summary.alignment[direction] = (summary.alignment[direction] ?? 0) + PHYSICS.step;
          if (user.vel.length() > 1 && user.vel.clone().normalize().dot(cmd.move) >= Math.cos(Math.PI / 6)) aligned.add(direction);
        }
      }
      if (match.ball.owner === user) summary.possession += PHYSICS.step;
      if (previousOwner === user && match.ball.owner !== user && !match.events.some((e) => e.type === 'kick' && e.player === user)) summary.losses++;
      previousOwner = match.ball.owner;
      for (const p of match.players) {
        if (previousTackle.get(p) === 0 && p.tackleTimer > 0) {
          if (p === user) summary.userTackles++;
          else if (p.team !== user.team) summary.opponentTackles++;
          summary.tackleAttempts = summary.userTackles + summary.opponentTackles;
        }
        previousTackle.set(p, p.tackleTimer);
      }
      for (const event of match.events) {
        result.events.push(serializedEvent(event, end));
        if (event.type === 'touch' && event.player === user) summary.touches++;
        if (event.type === 'tackle' && event.success) summary.tackleSuccesses++;
        if (event.type === 'skill') summary.skills[event.id] = (summary.skills[event.id] ?? 0) + 1;
      }
      match.events.length = 0;
      for (const p of foes) {
        const d = Math.hypot(p.pos.x - user.pos.x, p.pos.z - user.pos.z);
        nearest = Math.min(nearest, d);
        if (summary.firstWithin2m === null && d <= 2) summary.firstWithin2m = +end.toFixed(6);
      }
      while (nextSample / hz <= end + 1e-9 && nextSample / hz <= script.duration + 1e-9) capture(nextSample++ / hz, keys);
      input.endFrame();
    }
    summary.possession = Math.min(1, summary.possession / (steps * PHYSICS.step));
    summary.nearestOpponent = Number.isFinite(nearest) ? nearest : null;
    return result;
  } finally {
    for (const p of PLAYGROUND_PARAMETERS) setParameter(p.key, p.key === 'windup' ? snapshot.MOTION_SELECT.windup : snapshot.DRIBBLE[p.key]);
  }
}
