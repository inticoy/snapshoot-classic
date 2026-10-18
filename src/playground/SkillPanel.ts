import * as THREE from 'three';
import type { Match } from '../gameplay/Match';
import { SKILLS, type Dir, type SkillDef } from '../gameplay/Skills';

/** Game이 연습장에 넘겨주는 화면 조작 (느린 화면·가까운 카메라) */
export interface PlaygroundView {
  setSpeed(scale: number): void;
  setCloseUp(view: { angle: number; facing: THREE.Vector3 } | null, snap?: boolean): void;
}

const ARROW: Record<Dir, string> = { F: '↑', FR: '↗', R: '→', BR: '↘', B: '↓', BL: '↙', L: '←', FL: '↖' };
/** FC 온라인에서 흔히 부르는 이름 */
const NICK: Record<string, string> = { step_over: '헛다리', heel_flick: '위아래', roulette: '마르세유', rainbow: '사포' };
const VIEWS = [
  { id: 'side', label: '옆', angle: 0 },
  { id: 'diag', label: '대각선', angle: Math.PI / 4 },
  { id: 'front', label: '정면', angle: Math.PI / 2 },
  { id: 'back', label: '뒤', angle: -Math.PI / 2 },
] as const;
const SPEEDS = [1, 0.5, 0.25] as const;
/** 연습장 선수는 +X(화면 오른쪽)를 보고 시작한다 */
const FACING = new THREE.Vector3(1, 0, 0);

/** 커맨드 표기 (↑ = 선수 앞) */
export function commandText(def: SkillDef, touch = false): string {
  const t = def.trigger;
  if (t.kind === 'z' && touch) return '스틱으로 입력할 수 없어요 · ▶ 시범';
  if (t.kind === 'fake' && touch) return `${t.from === 'shoot' ? '슛' : '로빙'} 게이지 중 패스`;
  if (t.kind === 'fake') return `${t.from === 'shoot' ? 'D' : 'A'} 게이지 중 S`;
  const seq = t.seq.map((s) => `${ARROW[s.dir]}${s.hold ? ' 꾹' : ''}`).join(t.seq.some((s) => s.hold) ? ' ' : '');
  const taps = t.seq.length > 1 && t.seq.every((s) => s.tap) ? ' (짧게)' : t.seq.length === 1 && t.seq[0].tap ? ' 짧게' : '';
  return `${touch ? '개인기 스틱' : t.kind === 'shift' ? 'Shift' : 'Z'} + ${seq}${taps}`;
}

interface Group { key: string; name: string; nick?: string; stars: number; variants: { label: string; def: SkillDef }[]; rig: boolean }

/** 좌우 짝을 한 줄로 묶는다 (오른쪽/왼쪽 ○○, _r/_l) */
function groups(): Group[] {
  const out = new Map<string, Group>();
  for (const def of SKILLS) {
    const side = def.name.startsWith('오른쪽 ') ? '오른쪽' : def.name.startsWith('왼쪽 ') ? '왼쪽' : null;
    const name = side ? def.name.slice(side.length + 1) : def.name;
    const key = def.id.replace(/_[rl]$/, '');
    const g = out.get(key) ?? { key, name, nick: NICK[key], stars: def.stars, variants: [], rig: false };
    g.variants.push({ label: side ?? '보기', def });
    g.rig ||= !!def.rig;
    out.set(key, g);
  }
  return [...out.values()].sort((a, b) => a.stars - b.stars);
}

/**
 * 연습장 '개인기' 탭: 개인기 목록(커맨드)·▶ 시범·느린 화면·가까운 카메라·방금 쓴 개인기 표시.
 * 시범은 같은 개인기 실행기를 그대로 부르므로 키보드로 낸 것과 똑같이 움직인다.
 */
export class SkillPanel {
  private speed: number = 1;
  private view: typeof VIEWS[number]['id'] | 'off' = 'side';
  private repeat: SkillDef | null = null;
  private again = 0;
  private active = true;
  private readonly toast = document.createElement('div');
  private toastTimer = 0;
  private readonly shownEvents = new WeakSet<object>();
  private readonly touch = document.documentElement.classList.contains('touch-device');
  private readonly last: HTMLElement;

  constructor(private readonly match: Match, root: HTMLElement, private readonly gameView: PlaygroundView, private readonly resetFree: () => void) {
    const list = groups();
    root.innerHTML = `
      <p class="pg-help">▶를 누르면 시범을 볼 수 있어요. 직접 하려면 공을 가진 채 ${this.touch ? '개인기 스틱을 안내 방향으로 움직여요' : '커맨드를 입력해요'} (↑는 선수가 보는 방향이에요).</p>
      <div class="pg-row" role="group" aria-label="재생 속도">${SPEEDS.map((s) => `<button data-speed="${s}" aria-pressed="${s === 1}">${s === 1 ? '보통' : `${s}×`}</button>`).join('')}
        <label class="pg-inline"><input type="checkbox" id="pg-repeat"> 반복</label></div>
      <div class="pg-row" role="group" aria-label="카메라">${VIEWS.map((v) => `<button data-view="${v.id}" aria-pressed="${v.id === 'side'}">${v.label}</button>`).join('')}<button data-view="off" aria-pressed="false">경기 카메라</button></div>
      <p class="pg-last">방금 쓴 개인기 <b id="pg-last-skill">—</b></p>
      <ul class="pg-skills">${list.map((g) => `
        <li><div class="pg-skill-name"><span class="pg-stars">${'★'.repeat(g.stars)}</span> ${g.name}${g.nick ? ` <em>${g.nick}</em>` : ''}${g.rig ? ' <i class="pg-new">새 동작</i>' : ''}</div>
          ${g.variants.map((v) => `<div class="pg-skill-row"><code>${commandText(v.def, this.touch)}</code>${v.def.sustained ? '<small>직접 입력</small>' : `<button data-demo="${v.def.id}" aria-label="${v.def.name} 시범">▶ ${g.variants.length > 1 ? v.label : ''}</button>`}</div>${SKILLS.filter((d) => d.stars > v.def.stars && JSON.stringify(d.trigger) === JSON.stringify(v.def.trigger)).map((d) => `<small class="pg-help">★${d.stars} 선수는 ${d.name} 동작을 해요</small>`).join('')}`).join('')}
        </li>`).join('')}</ul>`;
    this.last = root.querySelector('#pg-last-skill')!;
    root.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((b) => {
      b.onclick = () => this.demo(SKILLS.find((s) => s.id === b.dataset.demo)!);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.onclick = () => {
        this.speed = Number(b.dataset.speed);
        root.querySelectorAll('[data-speed]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        this.apply();
      };
    });
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
      b.onclick = () => {
        this.view = b.dataset.view as typeof this.view;
        root.querySelectorAll('[data-view]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        this.apply();
      };
    });
    root.querySelector<HTMLInputElement>('#pg-repeat')!.onchange = (e) => {
      if (!(e.target as HTMLInputElement).checked) this.cancelRepeat();
    };
    this.toast.className = 'pg-toast';
    this.toast.setAttribute('role', 'status');
    document.body.append(this.toast);
    this.apply();
    (window as unknown as { __skillDemo: (id: string) => boolean }).__skillDemo = (id) => {
      const def = SKILLS.find((s) => s.id === id);
      return def ? this.demo(def) : false;
    };
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.cancelRepeat();
    this.apply();
  }

  cancelRepeat(): void {
    this.repeat = null;
    this.again = 0;
  }

  private apply(snap = false): void {
    this.gameView.setSpeed(this.active ? this.speed : 1);
    const v = VIEWS.find((x) => x.id === this.view);
    this.gameView.setCloseUp(this.active && v ? { angle: v.angle, facing: FACING } : null, snap);
  }

  /** 자유 드리블로 되돌린 뒤 발 앞에 공을 두고 개인기를 바로 낸다 */
  demo(def: SkillDef): boolean {
    this.resetFree();
    const m = this.match, p = m.controlled;
    Object.defineProperty(p, 'profile', { value: { ...p.profile, skill: 5 }, configurable: true });
    p.vel.set(0, 0, 0);
    p.facing.copy(FACING);
    p.actionLock = 0;
    m.ball.reset(p.pos.x + 0.4, p.pos.z);
    m.ball.owner = p;
    const ok = m.skills.start(p, def);
    // 시범은 경기 스텝 밖에서 시작해 이벤트가 다음 스텝 전에 비워질 수 있으므로 바로 표시한다
    if (ok) {
      this.show(def);
      // 같은 시작 이벤트가 다음 스텝에도 남아 있으면 토스트 시간을 다시 늘리지 않는다.
      for (const e of m.events) if (e.type === 'skill' && e.player === p && e.id === def.id) this.shownEvents.add(e);
    }
    this.apply(true);
    const box = this.toast.ownerDocument.querySelector<HTMLInputElement>('#pg-repeat');
    this.repeat = ok && box?.checked ? def : null;
    this.again = 0;
    return ok;
  }

  private show(def: SkillDef): void {
    this.last.textContent = def.name;
    this.toast.innerHTML = `<b>${def.name}</b><span>${commandText(def, this.touch)}</span>`;
    this.toast.classList.add('show');
    this.toastTimer = performance.now() + 1600;
  }

  /** 고정 스텝마다: 개인기 이벤트 표시, 반복 재생 */
  step(dt: number): void {
    for (const e of this.match.events) {
      if (e.type !== 'skill' || e.player !== this.match.controlled || this.shownEvents.has(e)) continue;
      this.shownEvents.add(e);
      const def = SKILLS.find((s) => s.id === e.id);
      if (def) this.show(def);
    }
    if (this.toastTimer > 0 && performance.now() >= this.toastTimer) {
      this.toast.classList.remove('show');
      this.toastTimer = 0;
    }
    if (this.repeat && !this.match.skills.isActive(this.match.controlled) && (this.again += dt) > 1.2) this.demo(this.repeat);
  }
}
