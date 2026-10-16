import * as THREE from 'three';
import { PITCH, TEAM_COLORS } from '../config';
import { TEAMS } from '../data/Teams';
import type { Player } from '../entities/Player';
import type { Match } from '../gameplay/Match';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STA_SEGMENTS = 12;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const ATTACK_HINTS: [string, string][] = [
  ['D', '슛'],
  ['S', '패스'],
  ['W', '스루 패스'],
  ['A', '로빙 패스'],
  ['Z+D', '감아차기'],
  ['Q+D', '칩슛'],
  ['E', '질주'],
];
const DEFENCE_HINTS: [string, string][] = [
  ['D', '압박'],
  ['Q', '동료 압박'],
  ['C', '견제'],
  ['Space', '스탠딩 태클'],
  ['A', '슬라이딩 태클'],
  ['S', '선수 변경'],
];

const SETPIECE_HINTS: Record<string, [string, string][]> = {
  throwin: [['←→', '조준'], ['S', '짧은 스로인'], ['A', '롱 스로인']],
  corner: [['←→', '조준'], ['A', '크로스'], ['S', '짧은 패스']],
  goalkick: [['←→', '조준'], ['A', '롱킥'], ['S', '짧은 패스']],
};
const SETPIECE_TITLE: Record<string, string> = { throwin: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK' };

const KIND_LABEL = { shoot: 'SHOT', pass: 'PASS', through: 'THROUGH', lob: 'LOB' } as const;

/**
 * 경기 중 HUD. EA FC 시리즈 배치를 참고:
 * 좌상단 스코어보드 / 머리 위 인디케이터 / 발밑 파워 게이지 /
 * 하단 좌우 선수 이름 바(스태미나) / 하단 중앙 레이더 / 골 자막
 */
export class Hud {
  private readonly root = $('hud');
  private readonly scoreH = $('score-h');
  private readonly scoreA = $('score-a');
  private readonly clock = $('clock');
  private readonly ticker = $('ticker');
  private readonly pi = $('pi');
  private readonly piName = $('pi-name');
  private readonly piStamina = $('pi-stamina');
  private readonly power = $('power');
  private readonly powerLabel = $('power-label');
  private readonly powerFill = $('power-fill');
  private readonly radar = $<HTMLCanvasElement>('radar');
  private readonly rc = this.radar.getContext('2d')!;
  private readonly hints = $('hints');
  private readonly nbLeft = $('nb-left');
  private readonly nbRight = $('nb-right');
  private readonly goalWord = $('goal-word');
  private readonly lowerThird = $('lower-third');
  private readonly proj = new THREE.Vector3();

  private tickerTimer = 0;
  private goalWordTimer = 0;
  private lowerThirdTimer = 0;
  private hintMode: string | null = null;
  private nbLeftPlayer: Player | null = null;
  private nbRightPlayer: Player | null = null;
  private lastScore = '';

  constructor() {
    $('abbr-h').textContent = TEAMS[0].abbr;
    $('abbr-a').textContent = TEAMS[1].abbr;
    // 레이더 고해상도
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.radar.style.width = `${this.radar.width}px`;
    this.radar.style.height = `${this.radar.height}px`;
    this.radar.width *= dpr;
    this.radar.height *= dpr;
    this.rc.scale(dpr, dpr);
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /** 스코어보드 아래 짧은 알림 (선방, 골대 등) */
  tick(text: string, seconds = 1.6): void {
    this.ticker.textContent = text;
    this.ticker.classList.add('show');
    this.tickerTimer = seconds;
  }

  goal(team: 0 | 1, title: string, sub: string, score: [number, number]): void {
    this.goalWord.textContent = title;
    this.goalWord.classList.add('show');
    this.goalWordTimer = 1.4;
    $('lt-strip').style.background = TEAM_COLORS[team].ui;
    $('lt-title').textContent = title;
    $('lt-sub').textContent = sub;
    $('lt-score').textContent = `${score[0]} - ${score[1]}`;
    setTimeout(() => {
      this.lowerThird.classList.add('show');
      this.lowerThirdTimer = 3.2;
    }, 700);
  }

  update(dt: number, match: Match, camera: THREE.Camera): void {
    const score = `${match.score[0]}-${match.score[1]}`;
    if (score !== this.lastScore) {
      this.scoreH.textContent = String(match.score[0]);
      this.scoreA.textContent = String(match.score[1]);
      this.lastScore = score;
    }
    // 실제 경기 시간을 90분으로 환산 (mm:ss)
    const t = Math.min(90 * 60, (match.clock / match.duration) * 90 * 60);
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    this.clock.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

    this.timers(dt);

    const live = match.phase !== 'goal' && match.phase !== 'fulltime';
    this.updateIndicator(match, camera, live);
    this.updateNameBars(match, live);
    this.updateHints(match, live);
    this.drawRadar(match);
  }

  private timers(dt: number): void {
    if (this.tickerTimer > 0 && (this.tickerTimer -= dt) <= 0) this.ticker.classList.remove('show');
    if (this.goalWordTimer > 0 && (this.goalWordTimer -= dt) <= 0) this.goalWord.classList.remove('show');
    if (this.lowerThirdTimer > 0 && (this.lowerThirdTimer -= dt) <= 0) this.lowerThird.classList.remove('show');
  }

  private updateIndicator(match: Match, camera: THREE.Camera, live: boolean): void {
    const p = match.controlled;
    this.proj.set(p.pos.x, 2.3, p.pos.z).project(camera);
    const visible = live && this.proj.z < 1;
    this.pi.style.display = visible ? 'flex' : 'none';
    if (visible) {
      this.pi.style.left = `${((this.proj.x + 1) / 2) * window.innerWidth}px`;
      this.pi.style.top = `${((1 - this.proj.y) / 2) * window.innerHeight}px`;
      this.piName.textContent = p.profile.short;
      this.piStamina.style.width = `${p.stamina * 100}%`;
      this.piStamina.style.background = staminaColor(p.stamina);
      // 스태미나가 떨어지면 인디케이터가 흐려진다 (FC 26 Player Indicator Fade)
      this.pi.style.opacity = String(0.55 + 0.45 * Math.min(1, p.stamina * 1.6));
    }

    const charge = match.charge;
    this.power.classList.toggle('show', !!charge && live);
    if (charge) {
      this.proj.set(p.pos.x, 0, p.pos.z).project(camera);
      this.power.style.left = `${((this.proj.x + 1) / 2) * window.innerWidth - 30}px`;
      this.power.style.top = `${((1 - this.proj.y) / 2) * window.innerHeight + 14}px`;
      this.powerLabel.textContent =
        charge.kind === 'shoot' && charge.finesse ? 'FINESSE'
        : charge.kind === 'shoot' && charge.chip ? 'CHIP'
        : charge.kind === 'through' && charge.chip ? 'LOB THRU'
        : KIND_LABEL[charge.kind];
      this.powerFill.style.width = `${charge.value * 100}%`;
    }
  }

  private updateNameBars(match: Match, live: boolean): void {
    const me = match.controlled;
    // 오른쪽: 상대 공 소유자, 없으면 공에 가장 가까운 상대
    const owner = match.ball.owner;
    let opp: Player | null = owner && owner.team === 1 ? owner : null;
    if (!opp) {
      const b = match.ball.position;
      let best = Infinity;
      for (const o of match.teams[1]) {
        if (o.isKeeper) continue;
        const d = Math.hypot(o.pos.x - b.x, o.pos.z - b.z);
        if (d < best) {
          best = d;
          opp = o;
        }
      }
    }
    this.nbLeft.classList.toggle('off', !live);
    this.nbRight.classList.toggle('off', !live);
    if (this.nbLeftPlayer !== me) {
      this.nbLeftPlayer = me;
      this.renderNameBar(this.nbLeft, me);
    }
    if (opp && this.nbRightPlayer !== opp) {
      this.nbRightPlayer = opp;
      this.renderNameBar(this.nbRight, opp);
    }
    this.updateStamina(this.nbLeft, me);
    if (opp) this.updateStamina(this.nbRight, opp);
  }

  private renderNameBar(el: HTMLElement, p: Player): void {
    const c = TEAM_COLORS[p.team];
    const prof = p.profile;
    el.style.setProperty('--team', hex(p.isKeeper ? c.keeper : c.shirt));
    el.style.setProperty('--team-ink', p.team === 1 && !p.isKeeper ? '#0b0f17' : '#fff');
    const stars = '★'.repeat(prof.skill) + '<span style="opacity:.25">' + '★'.repeat(5 - prof.skill) + '</span>';
    el.innerHTML = `
      <div class="nb-num"><b>${prof.number}</b><small>${prof.pos}</small></div>
      <div class="nb-main">
        <span class="nb-name">${prof.short}</span>
        <span class="nb-stars">${stars}</span>
        <span class="nb-tag">${prof.foot === 'L' ? '왼발' : '오른발'}</span>
        <span class="nb-tag ovr">${prof.ovr}</span>
      </div>
      <div class="nb-sta">${'<i></i>'.repeat(STA_SEGMENTS)}</div>`;
  }

  private updateStamina(el: HTMLElement, p: Player): void {
    const segs = el.querySelectorAll<HTMLElement>('.nb-sta i');
    const on = Math.ceil(p.stamina * STA_SEGMENTS);
    el.style.setProperty('--sta', staminaColor(p.stamina));
    segs.forEach((s, i) => s.classList.toggle('on', i < on));
  }

  private updateHints(match: Match, live: boolean): void {
    this.hints.style.display = live ? 'flex' : 'none';
    const owner = match.ball.owner;
    const sp = match.setPieces.current;
    const userSetPiece = match.phase === 'setpiece' && sp && sp.taker === match.controlled;
    const mode = userSetPiece
      ? sp!.kind
      : owner && owner.team === 0 ? 'attack' : owner ? 'defence' : this.hintMode ?? 'attack';
    if (mode === this.hintMode) return;
    this.hintMode = mode;
    const list = SETPIECE_HINTS[mode] ?? (mode === 'attack' ? ATTACK_HINTS : DEFENCE_HINTS);
    const title = SETPIECE_TITLE[mode] ?? (mode === 'attack' ? 'ATTACK' : 'DEFENCE');
    this.hints.innerHTML =
      `<div class="hint-mode">${title}</div>` +
      list.map(([k, label]) => `<div class="hint">${label} ${k.split('+').map((x) => `<kbd>${x}</kbd>`).join('+')}</div>`).join('');
  }

  private drawRadar(match: Match): void {
    const g = this.rc;
    const W = 220, H = 140;
    const pad = 10;
    const sx = (W - pad * 2) / PITCH.length;
    const sz = (H - pad * 2) / PITCH.width;
    const X = (x: number) => pad + (x + PITCH.halfL) * sx;
    const Z = (z: number) => pad + (z + PITCH.halfW) * sz;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    g.strokeRect(X(-PITCH.halfL), Z(-PITCH.halfW), PITCH.length * sx, PITCH.width * sz);
    g.beginPath();
    g.moveTo(X(0), Z(-PITCH.halfW));
    g.lineTo(X(0), Z(PITCH.halfW));
    g.stroke();
    g.beginPath();
    g.arc(X(0), Z(0), PITCH.centerCircle * sx, 0, Math.PI * 2);
    g.stroke();
    for (const s of [-1, 1]) {
      const x0 = X(s * PITCH.halfL), x1 = X(s * (PITCH.halfL - PITCH.boxDepth));
      g.strokeRect(Math.min(x0, x1), Z(-PITCH.boxWidth / 2), Math.abs(x1 - x0), PITCH.boxWidth * sz);
    }
    for (const p of match.players) {
      const x = X(p.pos.x), y = Z(p.pos.z);
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fillStyle = p.isKeeper ? hex(TEAM_COLORS[p.team].keeper) : TEAM_COLORS[p.team].ui;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.stroke();
      if (p === match.controlled) {
        // 내 선수: 위쪽 삼각형 마커
        g.beginPath();
        g.moveTo(x, y - 7);
        g.lineTo(x - 4, y - 12);
        g.lineTo(x + 4, y - 12);
        g.closePath();
        g.fillStyle = '#2ef59a';
        g.fill();
      }
    }
    const b = match.ball.position;
    g.beginPath();
    g.arc(X(b.x), Z(b.z), 2.6, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
  }
}

function staminaColor(s: number): string {
  return s > 0.5 ? '#2ef59a' : s > 0.25 ? '#ffd84d' : '#ff5a4e';
}
