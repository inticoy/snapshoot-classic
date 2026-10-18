import { afterEach, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { Menu, SquadView } from '../src/ui/Menu';
import { TEAMS } from '../src/data/Teams';
import { FORMATION_433 } from '../src/data/Formation';
import { accelType, heightOf } from '../src/data/Stats';
import { simulation } from './helpers';

let win: Window | undefined;
afterEach(async () => { await win?.happyDOM.abort(); vi.unstubAllGlobals(); });

function setup() {
  win = new Window();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', win.document);
  document.body.innerHTML = '<div id="overlay"></div>';
  const squad = new SquadView(), menu = new Menu();
  const back = vi.fn();
  menu.open({ eyebrow: '경기 준비', title: '스쿼드', items: [{ id: 'back', label: '뒤로', onSelect: back }], panel: squad.panel, bindPanel: squad.bind, onBack: back });
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const pick = (index: number, bench = false) => click(`[data-player="${index}"][data-bench="${bench}"]`);
  return { squad, menu, click, pick, back };
}

it('팀별 포메이션 카드 11장과 벤치 5장이 있고 선택한 선수의 모든 능력치를 펼친다', () => {
  const { click, pick } = setup();
  for (const team of [0, 1] as const) {
    click(`[data-team="${team}"]`);
    expect(document.querySelectorAll('.squad-pitch .squad-player')).toHaveLength(11);
    expect(document.querySelectorAll('.squad-bench .squad-player')).toHaveLength(5);
    const all = [...TEAMS[team].players, ...TEAMS[team].bench];
    expect(new Set(all.map((p) => p.number)).size).toBe(16);
    for (const [i, p] of all.entries()) {
      pick(i % 11, i >= 11);
      const detail = document.querySelector('#squad-detail')!;
      expect(detail.textContent).toContain(p.short);
      expect(detail.textContent).toContain(p.name);
      const expected = Object.values(p.stats).length;
      expect(detail.querySelectorAll('.sgroup li')).toHaveLength(expected);
      pick(i % 11, i >= 11);
    }
    for (const [i, slot] of FORMATION_433.entries()) {
      expect(document.querySelector(`[data-player="${i}"][data-bench="false"]`)!.textContent).toContain(slot.label);
    }
  }
});

it('양쪽 순서로 선발·벤치를 바꾸고 팀별 편집을 격리하며 기본 명단으로 되돌린다', () => {
  const { squad, click, pick } = setup();
  pick(9); pick(4, true);
  expect(squad.lineups[0][9]).toBe(TEAMS[0].bench[4]);
  expect(TEAMS[0].players[9].short).toBe('J. SON');
  expect(document.querySelector('.squad-bench')!.textContent).toContain(TEAMS[0].players[9].name);
  pick(4, true); pick(9);
  expect(squad.lineups[0][9]).toBe(TEAMS[0].players[9]);
  pick(0); pick(4, true);
  expect(squad.lineups[0][0]).toBe(TEAMS[0].players[0]);
  expect(document.querySelector('[role="status"]')!.textContent).toContain('골키퍼');
  click('[data-clear]');
  pick(0, true); pick(0);
  expect(squad.lineups[0][0]).toBe(TEAMS[0].bench[0]);
  click('[data-team="1"]');
  pick(9); pick(4, true);
  expect(squad.lineups[1][9]).toBe(TEAMS[1].bench[4]);
  click('[data-reset]');
  expect(squad.lineups[1]).toEqual(TEAMS[1].players);
  expect(squad.lineups[0][0]).toBe(TEAMS[0].bench[0]);
});

it('키보드로 상세·교체·선택 해제·뒤로 가기를 조작한다', () => {
  const { squad, menu, back } = setup();
  document.querySelector<HTMLElement>('[data-player="9"][data-bench="false"]')!.focus();
  menu.handleKey('Enter');
  expect(document.activeElement?.getAttribute('aria-expanded')).toBe('true');
  menu.handleKey('ArrowRight');
  expect((document.activeElement as HTMLElement).dataset.player).toBe('10');
  document.querySelector<HTMLElement>('[data-player="4"][data-bench="true"]')!.focus();
  document.activeElement!.dispatchEvent(new win!.KeyboardEvent('keydown', { code: 'Space', bubbles: true }) as unknown as Event);
  expect(squad.lineups[0][9]).toBe(TEAMS[0].bench[4]);
  menu.handleKey('Escape');
  expect(back).toHaveBeenCalledOnce();
  menu.close();
  expect(document.activeElement?.closest('.squad-view')).toBeNull();
});

it('새 경기에는 바뀐 선수의 능력치·등번호·외형 생성 정보를 적용하고 기본 경기는 격리한다', () => {
  const { squad, pick } = setup();
  pick(9); pick(4, true);
  vi.unstubAllGlobals();
  const { match } = simulation(3);
  const before = match.players[9];
  match.restart(squad.lineups);
  const player = match.teams[0][9], profile = TEAMS[0].bench[4];
  expect(player).not.toBe(before);
  expect(player.profile).toBe(profile);
  expect(player.number).toBe(profile.number);
  expect(player.name).toBe(profile.short);
  expect(player.slot).toBe(FORMATION_433[9]);
  expect(player.height).toBe(heightOf(profile.name, profile.pos));
  expect(player.accelType).toBe(accelType(profile.stats, player.height));
  expect(match.controlled).toBe(player);
  match.restart(squad.lineups);
  expect(match.teams[0][9]).toBe(player);
  const online = simulation(3, { userTeams: [true, true] }).match;
  online.restart();
  expect(online.teams.map((team) => team.map((p) => p.profile))).toEqual(TEAMS.map((t) => t.players));
});

it('교체한 선발 선수도 경기에서 AI로 움직인다', async () => {
  const { simulation, command } = await import('./helpers');
  const { TEAMS } = await import('../src/data/Teams');
  const { PHYSICS } = await import('../src/config');
  const { match } = simulation(2);
  const lineups = [TEAMS[0].players.slice(), TEAMS[1].players.slice()];
  const bench = TEAMS[0].bench.find((b) => b.pos === 'CM')!;
  const slot = lineups[0].findIndex((p) => p.pos === 'CM');
  lineups[0][slot] = bench;
  match.restart(lineups);
  const sub = match.players.find((p) => p.profile === bench)!;
  expect(sub).toBeDefined();
  const start = sub.pos.clone();
  for (let t = 0; t < 8; t += PHYSICS.step) match.update(PHYSICS.step, command());
  expect(sub.pos.distanceTo(start)).toBeGreaterThan(1);
});
