import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALL } from '../src/config';
import { dragBackRig, heelFlickRig, rainbowRig, rouletteRig, stepOverRig } from '../src/data/SkillRigs';
import { SKILLS, type RigPose } from '../src/gameplay/Skills';
import { REAL, SKILL_ROLL_DECEL } from '../src/physics/presets';
import { simulation } from './helpers';

const position = (p: RigPose) => new THREE.Vector3(p.ball.x, p.ball.y, p.ball.z);

describe('개인기 터치 사이 공 구름', () => {
  it('힐 플릭은 뒤꿈치 터치 뒤 감속하고 왼발 터치 시각에 정확히 도착한다', () => {
    const rig = heelFlickRig();
    const start = position(rig(0.2)), end = position(rig(0.36));
    expect(start.toArray()).toEqual([0.06, BALL.radius, 0.43]);
    expect(end.distanceTo(new THREE.Vector3(-0.16, BALL.radius, 0.16))).toBeLessThan(1e-12);
    const early = position(rig(0.24)).distanceTo(position(rig(0.22))) / 0.02;
    const late = position(rig(0.34)).distanceTo(position(rig(0.32))) / 0.02;
    expect(early - late).toBeCloseTo(SKILL_ROLL_DECEL * 0.1, 8);
    expect(late).toBeGreaterThan(0);
    expect(position(rig(0.1)).distanceTo(start)).toBe(0);
  });

  it.each([['스텝오버', stepOverRig, 0.46], ['힐 플릭', heelFlickRig, 0.36]] as const)('전진 터치에서 발끝 앞면과 공 중심 사이에 공 반지름을 남긴다 (%s)', (_name, makeRig, t) => {
    const pose = makeRig()(t), foot = pose.L;
    const toe = new THREE.Vector3(foot.x, foot.y, foot.z).add(new THREE.Vector3(
      Math.sin(foot.yaw) * Math.cos(foot.pitch), Math.sin(foot.pitch), Math.cos(foot.yaw) * Math.cos(foot.pitch),
    ).multiplyScalar(0.13));
    expect(toe.distanceTo(position(pose))).toBeCloseTo(BALL.radius, 8);
  });

  it.each([['힐 플릭', heelFlickRig, 0.2], ['레인보우', rainbowRig, 0.42]] as const)('뒤꿈치 접촉면도 공 중심과 반지름만큼 떨어진다 (%s)', (_name, makeRig, t) => {
    const pose = makeRig()(t), foot = t === 0.2 ? pose.R : pose.L;
    const heel = new THREE.Vector3(foot.x, foot.y, foot.z).add(new THREE.Vector3(
      -Math.sin(foot.yaw) * Math.cos(foot.pitch), -Math.sin(foot.pitch), -Math.cos(foot.yaw) * Math.cos(foot.pitch),
    ).multiplyScalar(0.05));
    expect(heel.distanceTo(position(pose))).toBeCloseTo(BALL.radius, 8);
  });

  it.each([
    ['드래그백', dragBackRig, 0.12, 0.3], ['룰렛 오른발', rouletteRig, 0.108, 0.306], ['룰렛 왼발', rouletteRig, 0.495, 0.675], ['레인보우', rainbowRig, 0.1, 0.24],
  ] as const)('발바닥 끌기에는 자유 구름 감속을 넣지 않는다 (%s)', (_name, makeRig, from, to) => {
    const rig = makeRig();
    expect(position(rig((from + to) / 2)).distanceTo(position(rig(from)).lerp(position(rig(to)), 0.5))).toBeLessThan(1e-10);
  });

  it('레인보우는 키 사이에서도 중력 포물선을 유지한다', () => {
    const rig = rainbowRig();
    for (const t of [0.421, 0.435, 0.713, 0.899, 0.9]) {
      const s = t - 0.42, ball = rig(t).ball;
      expect(ball.x).toBeCloseTo(-0.04 + 0.06 * s, 10);
      expect(ball.y).toBeCloseTo(0.32 + 6.7 * s - 0.5 * REAL.gravity * s * s, 10);
      expect(ball.z).toBeCloseTo(-0.34 + 2.3 * s, 10);
    }
  });

  it.each(['heel_flick', 'step_over_r', 'drag_back', 'rainbow'])('%s 종료 직전 궤적 속도로 공을 계속 굴려 보낸다', (id) => {
    const { match } = simulation();
    const p = match.controlled, def = SKILLS.find((d) => d.id === id)!;
    p.pos.set(0, 0, 0); p.facing.set(0, 0, 1); p.vel.set(0, 0, 0); p.actionLock = 0;
    Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
    match.ball.reset(0, 0.4); match.ball.owner = p;
    expect(match.skills.start(p, def)).toBe(true);
    const end = position(def.rig!(def.duration)), before = position(def.rig!(def.duration - 0.02));
    const velocity = end.sub(before).divideScalar(0.02);
    match.skills.driveBodies(def.duration);
    match.skills.driveBall(1 / 120, null);
    expect(match.ball.velocity.x).toBeCloseTo(-velocity.x, 8);
    expect(match.ball.velocity.z).toBeCloseTo(velocity.z, 8);
    expect(match.ball.velocity.y).toBeCloseTo(velocity.y, 8);
    expect(match.ball.speed()).toBeGreaterThan(1);
  });
});

describe('개인기 공 시각 회전', () => {
  it.each([[0, 0.055], [0.055, 0], [0.033, -0.044]])('실제 변위 (%s, %s) / 반지름만큼 굴리고 뒤로 끌면 역회전한다', (dx, dz) => {
    const { match } = simulation();
    const ball = match.ball;
    ball.reset(); ball.syncVisual(); ball.setSkillRolling(true);
    const bodyQuaternion = ball.body.quaternion.clone(), angular = ball.body.angularVelocity.clone();
    ball.position.x += dx; ball.position.z += dz; ball.syncVisual();
    const distance = Math.hypot(dx, dz);
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx).normalize(), distance / BALL.radius);
    expect(ball.object.quaternion.angleTo(expected)).toBeLessThan(1e-7);
    expect(ball.body.quaternion).toEqual(bodyQuaternion);
    expect(ball.body.angularVelocity).toEqual(angular);
    ball.position.x -= dx; ball.position.z -= dz; ball.syncVisual();
    expect(ball.object.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    ball.setSkillRolling(false); ball.syncVisual();
    expect(ball.object.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
  });
});
