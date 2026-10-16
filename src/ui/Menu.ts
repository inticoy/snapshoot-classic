import { TEAMS } from '../data/Teams';
import { STAT_LABELS, faceStats } from '../data/Stats';
import type { MatchStats } from '../gameplay/Match';

export interface MenuItem {
  id: string;
  label: string;
  /** 좌우로 바꾸는 설정 값 */
  value?: () => string;
  onSelect?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  /** 이 항목에 커서가 있을 때 오른쪽에 보여줄 패널 */
  panel?: () => string;
}

export interface MenuScreen {
  eyebrow: string;
  title: string;
  items: MenuItem[];
  panel: () => string;
  onBack?: () => void;
}

/**
 * EA FC 스타일 메뉴: 왼쪽 세로 메뉴 + 오른쪽 상황 패널.
 * 키보드(↑↓←→ Enter Esc)와 마우스 모두 지원.
 */
export class Menu {
  private readonly root = document.getElementById('overlay')!;
  private screen: MenuScreen | null = null;
  private index = 0;

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(screen: MenuScreen): void {
    this.screen = screen;
    this.index = 0;
    this.root.classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.root.classList.add('hidden');
    this.screen = null;
  }

  /** 프레임마다 눌린 키 코드로 조작 */
  handleKey(code: string): void {
    const s = this.screen;
    if (!s) return;
    const item = s.items[this.index];
    switch (code) {
      case 'ArrowUp':
        this.index = (this.index - 1 + s.items.length) % s.items.length;
        break;
      case 'ArrowDown':
        this.index = (this.index + 1) % s.items.length;
        break;
      case 'ArrowLeft':
        item.onLeft?.();
        break;
      case 'ArrowRight':
        item.onRight?.();
        break;
      case 'Enter':
        if (item.onSelect) item.onSelect();
        else item.onRight?.();
        break;
      case 'Escape':
      case 'Backspace':
        s.onBack?.();
        break;
      default:
        return;
    }
    if (this.screen === s) this.render();
  }

  render(): void {
    const s = this.screen;
    if (!s) return;
    const active = s.items[this.index];
    const items = s.items
      .map((it, i) => {
        const value = it.value
          ? `<span class="value"><b>‹</b>${it.value()}<b>›</b></span>`
          : '';
        return `<li class="menu-item${i === this.index ? ' active' : ''}" data-i="${i}"><span class="ko">${it.label}</span>${value}</li>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="menu">
        <div class="menu-left">
          <div class="menu-eyebrow">${s.eyebrow}</div>
          <div class="menu-title">${s.title}</div>
          <ul class="menu-items">${items}</ul>
          <div class="menu-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
            <span><kbd>←</kbd><kbd>→</kbd> 변경</span>
            <span><kbd>Enter</kbd> 선택</span>
            ${s.onBack ? '<span><kbd>Esc</kbd> 뒤로</span>' : ''}
          </div>
        </div>
        <div class="menu-right">${active.panel ? active.panel() : s.panel()}</div>
      </div>`;
    this.root.querySelectorAll<HTMLElement>('.menu-item').forEach((el) => {
      const i = Number(el.dataset.i);
      el.addEventListener('mouseenter', () => {
        if (this.index !== i) {
          this.index = i;
          this.render();
        }
      });
      el.addEventListener('click', () => {
        this.index = i;
        this.handleKey('Enter');
      });
    });
  }
}

// ---------------------------------------------------------------- 패널

export function matchupPanel(score: [number, number] | null, meta: string[]): string {
  const [h, a] = TEAMS;
  const mid = score
    ? `<div class="big">${score[0]}</div><div class="vs">-</div><div class="big">${score[1]}</div>`
    : `<div class="vs">VS</div>`;
  return `
    <div class="card">
      <div class="matchup">
        <div class="side"><div class="crest home">${h.abbr}</div><div class="name">${h.name.toUpperCase()}</div></div>
        ${mid}
        <div class="side"><div class="crest away">${a.abbr}</div><div class="name">${a.name.toUpperCase()}</div></div>
      </div>
      <div class="match-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>
    </div>`;
}

export function controlsPanel(): string {
  const row = (keys: string[], label: string) =>
    `<li><span class="keys">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>${label}</li>`;
  return `
    <div class="card">
      <h3>CONTROLS · FC 온라인 키보드 배치</h3>
      <div class="keymap">
        <div>
          <h4>ATTACK</h4>
          <ul>
            ${row(['←', '↑', '↓', '→'], '이동')}
            ${row(['E'], '질주')}
            ${row(['D'], '슛 (꾹 눌러 파워)')}
            ${row(['Z', 'D'], '감아차기')}
            ${row(['Q', 'D'], '칩슛')}
            ${row(['S'], '짧은 패스')}
            ${row(['W'], '스루 패스')}
            ${row(['Q', 'W'], '로빙 스루 패스')}
            ${row(['A'], '로빙 패스')}
          </ul>
        </div>
        <div>
          <h4>DEFENCE</h4>
          <ul>
            ${row(['D'], '압박 (꾹)')}
            ${row(['Q'], '동료 압박 (꾹)')}
            ${row(['C'], '견제 (꾹)')}
            ${row(['Space'], '스탠딩 태클')}
            ${row(['A'], '슬라이딩 태클')}
            ${row(['S'], '선수 변경')}
          </ul>
          <h4 style="margin-top:18px">GAME</h4>
          <ul>
            ${row(['Esc'], '일시정지')}
            ${row(['V'], '카메라 전환')}
            ${row(['M'], '사운드')}
          </ul>
        </div>
      </div>
      <p style="margin-top:16px">공이 오는 중에 슛/패스 키를 미리 누르면 원터치로 처리됩니다. 슛 파워 게이지가 흰 선(80%)을 넘으면 공이 뜰 수 있어요.</p>
    </div>`;
}

export function statsPanel(stats: MatchStats, score: [number, number], title: string): string {
  const total = stats.possession[0] + stats.possession[1] || 1;
  const poss = [Math.round((stats.possession[0] / total) * 100), 0];
  poss[1] = 100 - poss[0];
  const passPct = (t: 0 | 1) => (stats.passes[t] ? Math.round((stats.passesDone[t] / stats.passes[t]) * 100) : 0);
  const rows: [string, number, number, string?][] = [
    ['점유율', poss[0], poss[1], '%'],
    ['슈팅', stats.shots[0], stats.shots[1]],
    ['유효 슈팅', stats.onTarget[0], stats.onTarget[1]],
    ['패스 성공률', passPct(0), passPct(1), '%'],
    ['태클 성공', stats.tackles[0], stats.tackles[1]],
  ];
  const bar = (v: number, max: number, side: 'l' | 'r') =>
    `<div class="bar ${side}"><i style="width:${max ? (v / max) * 100 : 0}%"></i></div>`;
  return `
    ${matchupPanel(score, [title])}
    <div class="card" style="margin-top:14px">
      <h3>MATCH FACTS</h3>
      <div class="stats">
        ${rows
          .map(([label, h, a, unit = '']) => {
            const max = Math.max(h, a, 1);
            return `<div class="stat-row"><span class="v">${h}${unit}</span>${bar(h, max, 'l')}<span class="label">${label}</span>${bar(a, max, 'r')}<span class="v r">${a}${unit}</span></div>`;
          })
          .join('')}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- 능력치

const STAT_GROUPS: [string, (keyof typeof STAT_LABELS)[]][] = [
  ['속도', ['sprintSpeed', 'acceleration']],
  ['슈팅', ['finishing', 'shotPower', 'longShots', 'curve']],
  ['패스', ['shortPassing', 'longPassing', 'vision']],
  ['드리블', ['dribbling', 'ballControl', 'agility', 'balance', 'reactions', 'composure']],
  ['수비', ['defAwareness', 'standingTackle', 'slidingTackle', 'interceptions']],
  ['피지컬', ['strength', 'stamina']],
  ['골키퍼', ['diving', 'handling', 'kicking', 'reflexes', 'positioning']],
];

function statTier(v: number): string {
  return v >= 85 ? 'elite' : v >= 75 ? 'good' : v >= 60 ? 'mid' : 'low';
}

export function playerCard(team: 0 | 1, index: number): string {
  const p = TEAMS[team].players[index];
  const keeper = p.pos === 'GK';
  const face = faceStats(p.stats, keeper);
  return `
    <div class="pcard ${team === 0 ? 'home' : 'away'}">
      <div class="pcard-top"><b>${p.ovr}</b><span>${p.pos}</span></div>
      <div class="pcard-name">${p.short}</div>
      <div class="pcard-face">${face.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      <div class="pcard-meta"><span>${p.foot === 'L' ? '왼발' : '오른발'}</span><span>약발 ${'★'.repeat(p.weakFoot)}</span><span>개인기 ${'★'.repeat(p.skill)}</span></div>
    </div>`;
}

export function playerDetailPanel(team: 0 | 1, index: number): string {
  const p = TEAMS[team].players[index];
  const groups = STAT_GROUPS.filter(([g]) => (p.pos === 'GK' ? true : g !== '골키퍼'));
  const rows = groups
    .map(([g, keys]) => {
      const items = keys
        .map((k) => {
          const v = (p.stats as Partial<Record<keyof typeof STAT_LABELS, number>>)[k];
          if (v === undefined) return '';
          return `<li><span>${STAT_LABELS[k]}</span><i><em class="${statTier(v)}" style="width:${v}%"></em></i><b class="${statTier(v)}">${v}</b></li>`;
        })
        .join('');
      return `<div class="sgroup"><h4>${g}</h4><ul>${items}</ul></div>`;
    })
    .join('');
  return `
    <div class="card detail">
      ${playerCard(team, index)}
      <div class="sgroups">${rows}</div>
    </div>`;
}

export function squadPanel(): string {
  return `
    <div class="card">
      <h3>SQUADS</h3>
      ${([0, 1] as const)
        .map(
          (t) => `<div class="squad-row"><div class="squad-team">${TEAMS[t].name.toUpperCase()}</div><div class="squad-cards">${[0, 1, 2]
            .map((i) => playerCard(t, i))
            .join('')}</div></div>`,
        )
        .join('')}
    </div>`;
}

export function assistPanel(kind: 'pass' | 'shot'): string {
  const pass = `
    <h3>PASS ASSISTANCE</h3>
    <p><b>보조</b> · 방향키 쪽 넓은 범위에서 동료를 찾아 방향과 세기를 자동으로 맞춥니다.<br/>
    <b>세미</b> · 좁은 범위의 동료에게 방향과 세기를 맞추지만, 게이지에 따라 세기가 조금 달라집니다.<br/>
    <b>수동</b> · 방향키와 게이지 그대로. 동료가 없어도 원하는 곳으로 찰 수 있습니다.</p>
    <p style="margin-top:10px">어떤 설정이든 <b>짧은 패스 · 긴 패스 · 시야</b> 능력치와 압박, 약발에 따라 오차가 생깁니다.</p>`;
  const shot = `
    <h3>SHOT ASSISTANCE</h3>
    <p><b>보조</b> · 방향키를 어디로 두든 골문 안을 노립니다 (입력은 좌우 선택).<br/>
    <b>세미</b> · 골문 근처까지만 보정. 방향을 잘못 주면 옆으로 빗나갑니다.<br/>
    <b>수동</b> · 방향키 방향 그대로 찹니다.</p>
    <p style="margin-top:10px">정확도는 <b>골 결정력</b>(박스 안) · <b>중거리 슛</b>(박스 밖) · <b>커브</b>(감아차기), 속도는 <b>슛 파워</b>. 압박·질주는 <b>침착성</b>이 버텨 줍니다.</p>`;
  return `<div class="card">${kind === 'pass' ? pass : shot}</div>`;
}
