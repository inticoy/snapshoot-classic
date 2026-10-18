import { TEAMS, type PlayerProfile } from '../data/Teams';
import { STAT_LABELS, faceStats } from '../data/Stats';
import { FORMATION_433 } from '../data/Formation';
import { PITCH, SQUAD_UI } from '../config';
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
  bindPanel?: (root: HTMLElement) => void;
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
    // 숨긴 카드에 포커스가 남으면 경기 중 Space 입력까지 메뉴가 받게 된다.
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.classList.add('hidden');
    this.screen = null;
  }

  /** 프레임마다 눌린 키 코드로 조작 */
  handleKey(code: string): void {
    const s = this.screen;
    if (!s) return;
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.closest('.squad-view')) {
      if (code === 'Enter') { focused.click(); return; }
      if (code.startsWith('Arrow')) {
        const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('.squad-view button')];
        const delta = code === 'ArrowLeft' || code === 'ArrowUp' ? -1 : 1;
        buttons[(buttons.indexOf(focused as HTMLButtonElement) + delta + buttons.length) % buttons.length]?.focus();
        return;
      }
    }
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
          ? `<span class="value"><button type="button" data-dir="left" aria-label="${it.label} 이전 값">‹</button><span>${it.value()}</span><button type="button" data-dir="right" aria-label="${it.label} 다음 값">›</button></span>`
          : '';
        return `<li class="menu-item${i === this.index ? ' active' : ''}" data-i="${i}"><button type="button" class="menu-select ko">${it.label}</button>${value}</li>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="menu">
        <div class="menu-left">
          <header class="brand">
            <img class="brand-logo" src="./brand/snapshoot-wordmark.png" alt="SnapShoot" />
            <span class="brand-mode">CLASSIC</span>
          </header>
          <div class="menu-heading">
            <div class="menu-eyebrow">${s.eyebrow}</div>
            <h1 class="menu-title">${s.title}</h1>
          </div>
          <ul class="menu-items">${items}</ul>
          <div class="menu-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
            <span><kbd>←</kbd><kbd>→</kbd> 변경</span>
            <span><kbd>Enter</kbd> 선택</span>
            ${s.onBack ? '<button type="button" class="menu-back">뒤로</button>' : ''}
          </div>
        </div>
        <div class="menu-right" role="region" aria-label="${active.label} 내용" tabindex="0">${active.panel ? active.panel() : s.panel()}</div>
      </div>`;
    this.root.querySelectorAll<HTMLElement>('.menu-item').forEach((el) => {
      const i = Number(el.dataset.i);
      el.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse' && this.index !== i) {
          this.index = i;
          this.render();
        }
      });
      el.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.index = i;
          this.handleKey(button.dataset.dir === 'left' ? 'ArrowLeft' : 'ArrowRight');
        });
      });
      el.addEventListener('click', () => {
        this.index = i;
        this.handleKey('Enter');
      });
    });
    this.root.querySelector('.menu-back')?.addEventListener('click', () => s.onBack?.());
    s.bindPanel?.(this.root.querySelector<HTMLElement>('.menu-right')!);
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
      <h3>조작법</h3>
      <p class="touch-instructions">왼쪽 빈 곳을 누른 채 끌면 이동해요. 오른쪽 개인기 스틱을 누른 채 8방향으로 움직이면 개인기를 써요. 짧게 움직였다 놓으면 탭으로, 길게 유지하면 길게 누르기로 입력돼요. 오른쪽 슛·패스 버튼을 길게 눌러 세기를 조절한 뒤 놓아요. 패스 버튼을 누른 채 위로 밀면 스루 패스, 아래로 밀면 로빙 패스를 해요. 슛 버튼을 위로 밀며 놓으면 칩슛, 좌우로 밀며 놓으면 감아차기를 해요. 수비할 때는 압박·태클·선수 변경 버튼으로 바뀌어요. 압박 버튼을 밀면 슬라이딩 태클을 해요. 페널티킥을 찰 때는 조이스틱을 위아래로 움직여 구석을 골라요. 막을 때는 상대가 차는 순간 조이스틱 방향으로 골키퍼가 몸을 던져요.</p>
      <h4>FC 온라인 키보드 배치</h4>
      <div class="keymap">
        <div>
          <h4>공격</h4>
          <ul>
            ${row(['←', '↑', '↓', '→'], '이동')}
            ${row(['E'], '질주')}
            ${row(['D'], '슛 (길게 눌러 세기 조절)')}
            ${row(['Z', 'D'], '감아차기')}
            ${row(['Q', 'D'], '칩슛')}
            ${row(['S'], '짧은 패스')}
            ${row(['W'], '스루 패스')}
            ${row(['Q', 'W'], '로빙 스루 패스')}
            ${row(['A'], '로빙 패스')}
          </ul>
        </div>
        <div>
          <h4>수비</h4>
          <ul>
            ${row(['D'], '압박 (길게 누르기)')}
            ${row(['Q'], '동료 압박 (길게 누르기)')}
            ${row(['C'], '견제 (길게 누르기)')}
            ${row(['W'], '키퍼 돌진 (길게 누르기)')}
            ${row(['Space'], '스탠딩 태클')}
            ${row(['A'], '슬라이딩 태클')}
            ${row(['S'], '선수 변경')}
          </ul>
          <h4 style="margin-top:18px">페널티킥</h4>
          <ul>
            ${row(['↑', '↓'], '찰 때: 구석 선택 · 막을 때: 다이빙 방향')}
            ${row(['D'], '슛 (길게 눌러 세기 조절)')}
          </ul>
          <h4 style="margin-top:18px">게임</h4>
          <ul>
            ${row(['Esc'], '일시정지')}
            ${row(['V'], '카메라 전환')}
            ${row(['M'], '사운드')}
          </ul>
        </div>
      </div>
      <p style="margin-top:16px">공이 오는 동안 슛·패스 키를 미리 누르면 한 번의 터치로 처리해요. 슛 파워 게이지가 흰 선(80%)을 넘으면 공이 뜰 수 있어요.</p>
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
      <h3>경기 기록</h3>
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
  ['슈팅', ['finishing', 'shotPower', 'longShots', 'curve', 'volleys', 'heading']],
  ['패스', ['shortPassing', 'longPassing', 'vision']],
  ['드리블', ['dribbling', 'ballControl', 'agility', 'balance', 'reactions', 'composure']],
  ['수비', ['defAwareness', 'standingTackle', 'slidingTackle', 'interceptions']],
  ['피지컬', ['strength', 'jumping', 'stamina']],
  ['골키퍼', ['diving', 'handling', 'kicking', 'reflexes', 'positioning']],
];

function statTier(v: number): string {
  return v >= 85 ? 'elite' : v >= 75 ? 'good' : v >= 60 ? 'mid' : 'low';
}

export function playerCard(team: 0 | 1, index: number, p = TEAMS[team].players[index]): string {
  const keeper = p.pos === 'GK';
  const face = faceStats(p.stats, keeper);
  return `
    <div class="pcard ${team === 0 ? 'home' : 'away'}">
      <div class="pcard-top"><b>${p.ovr}</b><span>${p.pos}</span></div>
      <div class="pcard-name">${p.short}</div>
      <div class="pcard-face">${face.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      <div class="pcard-meta">${footBadges(p.foot, p.weakFoot)}<span class="skill">개인기 <b>${p.skill}</b>★</span></div>
    </div>`;
}

export function playerDetailPanel(team: 0 | 1, index: number, p = TEAMS[team].players[index]): string {
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
      ${playerCard(team, index, p)}
      <div class="sgroups">${rows}</div>
    </div>`;
}

/** 기본 팀 데이터는 그대로 두어 온라인 명단이 로컬 편집의 영향을 받지 않게 한다. */
export class SquadView {
  readonly lineups = TEAMS.map((team) => [...team.players]);
  private readonly benches = TEAMS.map((team) => [...team.bench]);
  private team: 0 | 1 = 0;
  private selected: { bench: boolean; index: number } | null = null;
  private notice = '';

  panel = (): string => {
    const team = this.team;
    const card = (p: PlayerProfile, index: number, bench: boolean) => {
      const selected = this.selected?.bench === bench && this.selected.index === index;
      const slot = !bench ? FORMATION_433[index] : null;
      // 킥오프 슬롯이 모여 있는 자기 진영을 세로로 펼쳐 모든 카드 사이의 간격을 확보한다.
      const lineWidth = slot ? Math.max(1, ...FORMATION_433.filter((s) => s.role === slot.role).map((s) => Math.abs(s.z))) : 1;
      const position = slot ? `left:${50 + slot.z / lineWidth * 38}%;top:${8 + (-slot.fx / PITCH.halfL) * 82}%` : '';
      const role = p.pos === 'GK' ? 'GK' : /^(LB|RB|CB)$/.test(p.pos) ? 'DEF' : /^(LW|RW|ST|CF)$/.test(p.pos) ? 'FWD' : 'MID';
      const initials = p.short.split(/[ .]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('');
      return `<button type="button" class="squad-player role-${role} ${team === 0 ? 'home' : 'away'}" data-player="${index}" data-bench="${bench}" style="${position}" aria-expanded="${selected}" aria-controls="squad-detail" aria-label="${slot?.label ?? '벤치'} ${p.name}, ${p.pos}, 종합 ${p.ovr}, 등번호 ${p.number}">
        <span class="squad-rating"><b>${p.ovr}</b><span class="squad-position">${slot?.label ?? p.pos}</span></span>
        <span class="squad-portrait" aria-hidden="true">${initials}</span>
        <span class="squad-name">${p.name}</span><span class="squad-number">#${p.number} · ${p.pos}</span></button>`;
    };
    const p = this.selected ? (this.selected.bench ? this.benches : this.lineups)[team][this.selected.index] : null;
    return `<section class="squad-view">
      <div class="squad-tabs" role="group" aria-label="팀 선택">${TEAMS.map((t, i) => `<button type="button" data-team="${i}" aria-pressed="${team === i}">${t.name}</button>`).join('')}</div>
      <div class="squad-heading"><h3>4-3-3 <span>STARTING XI</span></h3><div class="squad-actions"><button type="button" data-clear>선택 해제</button><button type="button" data-reset>기본 명단</button></div></div>
      <div class="squad-board"><div class="squad-stage">
        <div class="squad-pitch" aria-label="선발 포메이션"><div class="pitch-lines" aria-hidden="true"><i></i></div>${this.lineups[team].map((p, i) => card(p, i, false)).join('')}</div>
      </div><aside class="squad-reserves" aria-label="교체 선수"><h4>BENCH <span>05</span></h4><div class="squad-bench">${this.benches[team].map((p, i) => card(p, i, true)).join('')}</div></aside></div>
      <p class="squad-help">끌어서 교체 · 두 카드 선택으로도 교체 · GK끼리만 교체<br>Tab·방향키 이동 / Enter·Space 선택 · 다음 경기 적용 (온라인: 기본 명단)</p>
      <p class="squad-notice" role="status" aria-live="polite">${this.notice}</p>
      <div id="squad-detail" ${p ? '' : 'hidden'} role="region" aria-label="선수 능력치">${p ? `<header><h4>${p.name} · #${p.number} · ${p.pos}</h4><button type="button" data-detail-close aria-label="능력치 닫기">닫기 ×</button></header>${playerDetailPanel(team, 0, p)}` : ''}</div>
    </section>`;
  };

  bind = (root: HTMLElement): void => {
    const refresh = (selector: string) => {
      const scroll = root.scrollTop;
      root.innerHTML = this.panel();
      this.bind(root);
      root.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
      root.scrollTop = scroll;
    };
    root.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((button) => {
      button.onclick = () => {
        this.team = Number(button.dataset.team) as 0 | 1;
        this.selected = null;
        this.notice = '';
        refresh(`[data-team="${this.team}"]`);
      };
    });
    type Pick = { index: number; bench: boolean };
    const pick = (button: HTMLElement): Pick => ({ index: Number(button.dataset.player), bench: button.dataset.bench === 'true' });
    const selector = (p: Pick) => `[data-player="${p.index}"][data-bench="${p.bench}"]`;
    const roster = (p: Pick) => (p.bench ? this.benches : this.lineups)[this.team];
    const compatible = (a: Pick, b: Pick) => (a.bench !== b.bench || !a.bench)
      && (a.bench !== b.bench || a.index !== b.index)
      && (roster(a)[a.index].pos === 'GK') === (roster(b)[b.index].pos === 'GK');
    const swap = (a: Pick, b: Pick) => {
      if (!compatible(a, b)) {
        this.notice = '골키퍼는 골키퍼끼리 바꿀 수 있어요. 다른 선수를 골라요.';
        return;
      }
      const first = roster(a), second = roster(b);
      [first[a.index], second[b.index]] = [second[b.index], first[a.index]];
      this.notice = a.bench === b.bench ? '선수의 포지션 슬롯을 맞바꿨어요.' : '선발과 교체 선수를 맞바꿨어요.';
      this.selected = null;
    };
    root.querySelectorAll<HTMLButtonElement>('[data-player]').forEach((button) => {
      let suppressClick = false;
      button.onclick = (event) => {
        // 드래그 직후 브라우저가 만드는 클릭만 막고 키보드 선택은 그대로 받는다.
        if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
        suppressClick = false;
        const next = pick(button), prev = this.selected;
        this.notice = '';
        if (prev && (prev.bench !== next.bench || (!prev.bench && prev.index !== next.index))) swap(prev, next);
        else this.selected = prev?.bench === next.bench && prev.index === next.index ? null : next;
        refresh(selector(next));
      };
      button.onpointerdown = (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick = false;
        const source = pick(button), x = event.clientX, y = event.clientY;
        let ghost: HTMLElement | null = null;
        let target: HTMLButtonElement | null = null;
        button.setPointerCapture?.(event.pointerId);
        const move = (e: PointerEvent) => {
          if (e.pointerId !== event.pointerId) return;
          // 작은 손 떨림은 탭으로 처리한다.
          if (!ghost && Math.hypot(e.clientX - x, e.clientY - y) < SQUAD_UI.dragThreshold) return;
          if (!ghost) {
            const rect = button.getBoundingClientRect();
            ghost = button.cloneNode(true) as HTMLElement;
            ghost.removeAttribute('id');
            ghost.removeAttribute('data-player');
            ghost.removeAttribute('aria-controls');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.tabIndex = -1;
            ghost.classList.add('squad-drag-ghost');
            ghost.style.width = `${rect.width}px`;
            ghost.style.height = `${rect.height}px`;
            root.append(ghost);
            button.classList.add('is-dragging');
            root.querySelectorAll<HTMLButtonElement>('[data-player]').forEach((candidate) => {
              candidate.classList.toggle('is-droppable', compatible(source, pick(candidate)));
            });
          }
          e.preventDefault();
          ghost.style.left = `${e.clientX}px`;
          ghost.style.top = `${e.clientY}px`;
          target?.classList.remove('is-drop-target');
          const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLButtonElement>('[data-player]');
          target = hit && root.contains(hit) && compatible(source, pick(hit)) ? hit : null;
          target?.classList.add('is-drop-target');
        };
        const finish = (e: PointerEvent) => {
          if (e.pointerId !== event.pointerId) return;
          if (ghost && e.type === 'pointerup') move(e);
          const dragged = !!ghost;
          ghost?.remove();
          root.querySelectorAll('.is-dragging, .is-droppable, .is-drop-target').forEach((el) => el.classList.remove('is-dragging', 'is-droppable', 'is-drop-target'));
          button.removeEventListener('pointermove', move);
          button.removeEventListener('pointerup', finish);
          button.removeEventListener('pointercancel', finish);
          button.removeEventListener('lostpointercapture', finish);
          if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
          if (!dragged) return;
          suppressClick = true;
          if (e.type === 'pointerup' && target) {
            const next = pick(target);
            swap(source, next);
            refresh(selector(next));
          }
        };
        button.addEventListener('pointermove', move);
        button.addEventListener('pointerup', finish);
        button.addEventListener('pointercancel', finish);
        button.addEventListener('lostpointercapture', finish);
      };
    });
    root.querySelector<HTMLButtonElement>('[data-detail-close]')?.addEventListener('click', () => {
      const selected = this.selected;
      this.selected = null;
      refresh(selected ? selector(selected) : '[data-clear]');
    });
    root.querySelector<HTMLButtonElement>('[data-clear]')!.onclick = () => {
      this.selected = null;
      this.notice = '';
      refresh('[data-clear]');
    };
    root.querySelector<HTMLButtonElement>('[data-reset]')!.onclick = () => {
      this.lineups[this.team] = [...TEAMS[this.team].players];
      this.benches[this.team] = [...TEAMS[this.team].bench];
      this.selected = null;
      this.notice = '기본 명단으로 되돌렸어요.';
      refresh('[data-reset]');
    };
    // Space는 경기 입력에 쓰이므로 스쿼드 안에서 먼저 처리한다.
    root.onkeydown = (event) => {
      if (event.code === 'Space' && (event.target as HTMLElement).closest('.squad-view button')) {
        event.preventDefault();
        event.stopPropagation();
        (event.target as HTMLElement).click();
      }
    };
  };
}

export function assistPanel(kind: 'pass' | 'shot'): string {
  const pass = `
    <h3>패스 보조</h3>
    <p><b>보조</b> · 방향키로 가리킨 쪽의 넓은 범위에서 동료를 찾아 방향과 세기를 자동으로 맞춰요.<br/>
    <b>세미</b> · 좁은 범위에서 동료를 찾아 방향과 세기를 맞춰요. 게이지에 따라 세기가 조금 달라져요.<br/>
    <b>수동</b> · 방향키와 게이지에 맞춰 차요. 동료가 없어도 원하는 곳으로 찰 수 있어요.</p>
    <p style="margin-top:10px">어떤 설정이든 <b>짧은 패스 · 긴 패스 · 시야</b> 능력치와 압박, 약발에 따라 오차가 생겨요.</p>`;
  const shot = `
    <h3>슛 보조</h3>
    <p><b>보조</b> · 방향키로 어느 쪽을 가리켜도 골문 안을 노려요. 입력 방향으로 골문의 왼쪽과 오른쪽을 골라요.<br/>
    <b>세미</b> · 골문 근처까지만 보정해요. 방향을 잘못 잡으면 옆으로 빗나가요.<br/>
    <b>수동</b> · 방향키로 가리킨 방향 그대로 차요.</p>
    <p style="margin-top:10px">정확도에는 박스 안에서 <b>골 결정력</b>, 박스 밖에서 <b>중거리 슛</b>, 감아차기에는 <b>커브</b>가 영향을 줘요. 공의 속도는 <b>슛 파워</b>에 따라 달라져요. <b>침착성</b>이 높으면 압박을 받거나 질주할 때 오차를 줄여 줘요.</p>`;
  return `<div class="card">${kind === 'pass' ? pass : shot}</div>`;
}

/** FC 온라인 표기: 양발 수치 (주발 5, 약발 1~5). 예) 오른발잡이 약발 3 → L3 R5 */
export function footBadges(foot: 'L' | 'R', weakFoot: number): string {
  const l = foot === 'L' ? 5 : weakFoot;
  const r = foot === 'R' ? 5 : weakFoot;
  return `<span class="foot${foot === 'L' ? ' main' : ''}">L<b>${l}</b></span><span class="foot${foot === 'R' ? ' main' : ''}">R<b>${r}</b></span>`;
}
