import * as THREE from 'three';
import { PLAYGROUND, PHYSICS } from '../config';
import { settings } from '../core/Settings';
import { Input, isEditing } from '../core/Input';
import type { Match, UserCommand } from '../gameplay/Match';
import { PLAYGROUND_PARAMETERS, PLAYGROUND_SCENARIOS, type PlaygroundScenario } from '../data/Playground';
import { PlaygroundScenarios } from './Scenarios';
import { parameterSnapshot, setParameter } from './Parameters';
import { runScript, runScriptAsync, scriptCommand, validateScript, type PlaygroundScript, type ScriptResult } from './Script';
import { SkillPanel, type PlaygroundView } from './SkillPanel';
import { initialTelemetry, recentHistory, recordsToCsv, updateTelemetry, type TelemetryMetrics, type TelemetrySample, type Vec3 } from './Telemetry';
import './style.css';

const vector = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const playerId = (p: Match['controlled'] | null) => p ? `${p.team}:${p.number}` : null;
const metrics = [
  ['playerSpeed', '선수 속도', 'm/s'], ['ballSpeed', '공 속도', 'm/s'], ['footDistance', '공–발끝 거리', 'm'],
  ['bodyInputAngle', '몸 ↔ 입력', '°'], ['ballInputAngle', '공 ↔ 입력', '°'], ['touchesPerSecond', '최근 1초 터치', '/s'],
  ['lastTurnSeconds', '마지막 전환', 's'], ['heavyTouches', '헤비 터치', '회'], ['losses', '소유 상실', '회'], ['hipsHeight', '엉덩이 높이', 'm'],
] as const;

/** 화면은 고정 스텝에 끼어들지 않는다. 기록은 매 스텝, 패널·그래프만 10Hz로 갱신한다. */
export class Playground {
  readonly scenarios: PlaygroundScenarios;
  private readonly root = document.createElement('details');
  private readonly output: HTMLElement;
  private readonly initialParameters = parameterSnapshot();
  private parameters = parameterSnapshot();
  private state = initialTelemetry();
  private history: TelemetryMetrics[] = [];
  private readonly recordBuffer: Record<string, unknown>[] = [];
  private recordHead = 0;
  private settingsSnapshot = { ...settings };
  private scriptProgress: number | null = null;
  private runVersion = 0;

  /** 내보낼 때만 시간순으로 펼치고, 기록은 최근 5분의 링에 일정 비용으로 쓴다. */
  get records(): Record<string, unknown>[] {
    return this.recordHead === 0 ? this.recordBuffer.slice() : [...this.recordBuffer.slice(this.recordHead), ...this.recordBuffer.slice(0, this.recordHead)];
  }
  latest: TelemetryMetrics | null = null;
  private nextRender = 0;
  private readonly toe = new THREE.Vector3();
  private readonly ball = new THREE.Vector3();
  private script: PlaygroundScript | null = null;
  private scriptResult: ScriptResult | null = null;
  private scriptInput = new Input({ addEventListener() {} } as unknown as Window);
  private scriptRows = 0;
  private scriptHeld: string[] = [];

  private readonly skills: SkillPanel;

  constructor(private readonly match: Match, private readonly onReset: () => void, view: PlaygroundView) {
    this.scenarios = new PlaygroundScenarios(match);
    document.body.classList.add('playground');
    this.root.id = 'playground';
    this.root.open = !document.documentElement.classList.contains('touch-device') && !window.matchMedia('(pointer: coarse)').matches;
    this.root.innerHTML = `<summary>연습장 <span>접기 / 펼치기</span></summary>
      <div class="pg-tabs" role="tablist">
        <button role="tab" data-tab="skills" aria-selected="true">개인기</button>
        <button role="tab" data-tab="drills" aria-selected="false">상황 연습</button>
        <button role="tab" data-tab="dev" aria-selected="false">개발 도구</button>
      </div>
      <div class="pg-body">
        <section data-panel="skills"></section>
        <section data-panel="drills" hidden>
        <nav aria-label="시나리오">${PLAYGROUND_SCENARIOS.map((s) => `<button data-scenario="${s.id}">${s.label}</button>`).join('')}</nav>
        <p id="pg-hint"></p>
        <div class="pg-row"><button id="pg-reset">R · 다시 시작</button>
        <label class="pg-inline">상대 <select id="pg-opponent"><option value="stand">정지</option><option value="follow">따라가기</option><option value="press" selected>압박</option><option value="tackle">태클</option></select></label></div>
        <p class="pg-help">방향키로 이동해요. E 질주 · S 패스 · W 스루 패스 · A 로빙 패스/슬라이딩 태클 · D 슛 · Space 스탠딩 태클 · V 카메라 전환 · Tab 상대 조작 · R 다시 시작</p>
        </section>
        <section data-panel="dev" hidden>
        <details><summary>스크립트 실행</summary><textarea id="pg-script" aria-label="스크립트 JSON" placeholder="JSON을 붙여 넣거나 파일을 끌어다 놓아요"></textarea><input id="pg-script-file" type="file" accept=".json,application/json"><button id="pg-script-run">실행</button><button id="pg-script-download" disabled>결과 JSON 다운로드</button></details>
        <p id="pg-status" role="status"></p>
        <p class="pg-help">그래프는 최근 5초를 보여 주고, 항목마다 눈금을 자동으로 맞춰요. 멈춰 있어 방향이 없으면 —로 표시해요. 공의 방향이 입력 방향의 ±30° 안에 들어오면 방향 전환이 끝난 것으로 봐요.</p>
        <div class="pg-metrics">${metrics.map(([key, label, unit]) => `<div><label>${label}</label><output data-metric="${key}">—</output><small>${unit}</small><canvas width="100" height="24" data-graph="${key}" aria-label="${label} 최근 5초"></canvas></div>`).join('')}</div>
        <p>동작 <output id="pg-motion">—</output></p>
        <details><summary>파라미터 · 실시간 적용</summary><p class="pg-help">조정한 값은 이 페이지를 열어 둔 동안 적용돼요. R로 다시 시작해도 유지돼요.</p>
        ${PLAYGROUND_PARAMETERS.map((p) => `<label class="pg-parameter">${p.key} <output data-value="${p.key}"></output> ${p.unit}<input aria-label="${p.key}" data-param="${p.key}" type="range" min="${p.min}" max="${p.max}" step="${p.step}"></label>`).join('')}
        <button id="pg-defaults">기본값 복원</button><button id="pg-copy">JSON 복사</button><textarea id="pg-values" aria-label="현재 파라미터 JSON" hidden readonly></textarea></details>
        <div class="pg-exports"><button id="pg-json">JSON 내보내기</button><button id="pg-csv">CSV 내보내기</button></div>
        <p class="pg-help">기록은 최근 5분만 보관해요. 다시 시작하면 지워지니 먼저 내보내요. 패스나 슛으로 공을 내보낸 경우는 소유권을 잃은 횟수에서 제외해요. 골·아웃·휘슬 뒤에는 R로 다시 시작해요.</p>
        </section>
      </div>`;
    document.body.append(this.root);
    // 편집 필드의 키는 패널 안에서 처리한다. 일반 버튼에서는 경기 입력을 계속 쓴다.
    this.root.addEventListener('keydown', (e) => {
      if (isEditing(e.target)) e.stopPropagation();
    });
    this.output = this.root.querySelector('#pg-status')!;
    this.skills = new SkillPanel(match, this.root.querySelector('[data-panel="skills"]')!, view, () => this.reset('free'));
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((tab) => {
      tab.onclick = () => this.showTab(tab.dataset.tab!);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
      button.onclick = () => this.reset(button.dataset.scenario as PlaygroundScenario);
    });
    this.root.querySelector<HTMLButtonElement>('#pg-reset')!.onclick = () => this.reset();
    this.root.querySelector<HTMLSelectElement>('#pg-opponent')!.onchange = (e) => this.reset(this.scenarios.current, (e.target as HTMLSelectElement).value as typeof this.scenarios.opponent);
    const scriptText = this.root.querySelector<HTMLTextAreaElement>('#pg-script')!;
    const readFile = async (file?: File) => { if (file) scriptText.value = await file.text(); };
    this.root.querySelector<HTMLInputElement>('#pg-script-file')!.onchange = (e) => void readFile((e.target as HTMLInputElement).files?.[0]);
    scriptText.ondragover = (e) => e.preventDefault();
    scriptText.ondrop = (e) => { e.preventDefault(); void readFile(e.dataTransfer?.files[0]); };
    this.root.querySelector<HTMLButtonElement>('#pg-script-run')!.onclick = async () => {
      try { await this.runAsync(JSON.parse(scriptText.value)); }
      catch (error) { this.output.textContent = error instanceof Error ? error.message : String(error); }
    };
    this.root.querySelector<HTMLButtonElement>('#pg-script-download')!.onclick = () => {
      if (this.scriptResult) this.downloadResult(this.scriptResult);
    };
    this.root.querySelectorAll<HTMLInputElement>('[data-param]').forEach((input) => {
      input.oninput = () => {
        setParameter(input.dataset.param as typeof PLAYGROUND_PARAMETERS[number]['key'], Number(input.value));
        this.syncParameters();
      };
    });
    this.root.querySelector<HTMLButtonElement>('#pg-defaults')!.onclick = () => {
      for (const p of PLAYGROUND_PARAMETERS) setParameter(p.key, p.key === 'windup' ? this.initialParameters.MOTION_SELECT.windup : this.initialParameters.DRIBBLE[p.key]);
      this.syncParameters();
    };
    this.root.querySelector<HTMLButtonElement>('#pg-copy')!.onclick = () => void this.copyParameters();
    this.root.querySelector<HTMLButtonElement>('#pg-json')!.onclick = () => this.download('json');
    this.root.querySelector<HTMLButtonElement>('#pg-csv')!.onclick = () => this.download('csv');
    window.addEventListener('keydown', (e) => {
      if (isEditing(e.target) || isEditing(document.activeElement)) return;
      if (e.code === 'Tab' && !e.repeat && !(e.target && this.root.contains(e.target as Node))) {
        e.preventDefault();
        const next = this.match.controlled.team === 0 ? this.match.players.find((p) => p.team === 1 && !p.isKeeper) : this.match.players.find((p) => p.team === 0 && !p.isKeeper);
        if (next) {
          this.match.controlled = next;
          this.match.practiceControlLocked = next.team === 1;
        }
      }
      if (e.code === 'KeyR' && !e.repeat && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        this.reset();
      }
    });
    this.syncParameters();
    this.reset('free');
    (window as unknown as { __playground: { run: (script: unknown) => Promise<ScriptResult> } }).__playground = { run: (script) => this.runAsync(script) };
  }

  get running(): boolean { return this.match.phase === 'playing'; }

  private showTab(id: string): void {
    for (const tab of this.root.querySelectorAll<HTMLElement>('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === id));
    for (const panel of this.root.querySelectorAll<HTMLElement>('[data-panel]')) panel.hidden = panel.dataset.panel !== id;
    // 개인기 탭을 떠나면 느린 화면·가까운 카메라를 끈다
    this.skills.setActive(id === 'skills');
  }

  reset(id?: PlaygroundScenario, opponent = this.scenarios.opponent): void {
    this.skills.cancelRepeat();
    this.skills.resetInput();
    this.onReset();
    this.script = null;
    this.scenarios.reset(id, PLAYGROUND.seed, opponent);
    this.root.querySelector<HTMLSelectElement>('#pg-opponent')!.value = opponent;
    this.state = initialTelemetry();
    this.history = [];
    this.recordBuffer.length = 0;
    this.recordHead = 0;
    this.runVersion++;
    this.latest = null;
    this.nextRender = 0;
    this.root.querySelector('#pg-hint')!.textContent = PLAYGROUND_SCENARIOS.find((s) => s.id === this.scenarios.current)!.hint;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-scenario]')) button.setAttribute('aria-pressed', String(button.dataset.scenario === this.scenarios.current));
    this.render();
  }

  /** JSON 결과와 화면 재생은 같은 시드·입력·시나리오 설정을 공유한다. */
  run(source: unknown): ScriptResult {
    const script = validateScript(source);
    const result = runScript(script);
    return this.playScript(script, result);
  }

  private playScript(script: PlaygroundScript, result: ScriptResult): ScriptResult {
    this.reset(script.scenario, script.opponent ?? 'press');
    this.scenarios.reset(script.scenario, script.seed, script.opponent ?? 'press', script.control ?? 'user');
    const user = this.match.controlled;
    if (script.skill !== undefined) Object.defineProperty(user, 'profile', { value: { ...user.profile, skill: script.skill }, configurable: true });
    for (const [key, value] of Object.entries(script.params ?? {})) setParameter(key.split('.')[1] as typeof PLAYGROUND_PARAMETERS[number]['key'], value);
    this.syncParameters();
    this.script = script;
    this.scriptResult = result;
    this.scriptRows = 0;
    this.scriptHeld = [];
    this.scriptInput = new Input({ addEventListener() {} } as unknown as Window);
    this.root.querySelector<HTMLButtonElement>('#pg-script-download')!.disabled = false;
    return result;
  }

  async runAsync(source: unknown): Promise<ScriptResult> {
    if (this.scriptProgress !== null) throw new Error('스크립트 실행이 끝날 때까지 기다려 주세요');
    const script = validateScript(source);
    const version = ++this.runVersion;
    const button = this.root.querySelector<HTMLButtonElement>('#pg-script-run')!;
    button.disabled = true;
    this.scriptProgress = 0;
    try {
      const result = await runScriptAsync(script, (progress) => {
        this.scriptProgress = progress;
        this.render();
      });
      // 계산 도중 R·시나리오 변경을 했다면 뒤늦게 화면 재생을 덮어쓰지 않는다.
      this.scriptResult = result;
      this.root.querySelector<HTMLButtonElement>('#pg-script-download')!.disabled = false;
      if (version === this.runVersion) this.playScript(script, result);
      return result;
    } finally {
      this.scriptProgress = null;
      button.disabled = false;
      this.render();
    }
  }

  commandForStep(): UserCommand | null {
    if (!this.script) return null;
    if (this.match.elapsed >= this.script.duration) {
      this.scriptInput.setVirtualKeys([]);
      return scriptCommand(this.scriptInput);
    }
    const taps: string[] = [];
    while (this.scriptRows < this.script.inputs.length && this.script.inputs[this.scriptRows].t <= this.match.elapsed + 1e-9) {
      const row = this.script.inputs[this.scriptRows++];
      if (row.keys) this.scriptHeld = [...row.keys];
      if (row.tap) taps.push(...row.tap);
    }
    this.scriptInput.setVirtualKeys([...new Set([...this.scriptHeld, ...taps])]);
    return scriptCommand(this.scriptInput);
  }

  endScriptStep(): void { this.scriptInput.endFrame(); }

  private downloadResult(result: ScriptResult): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `playground-script-${this.scenarios.current}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Match.events가 Game의 사운드 처리에서 비워지기 전에 호출해야 한다. */
  step(dt: number, cmd: UserCommand): void {
    const m = this.match, p = m.controlled;
    if (!this.script && cmd.move.lengthSq() > 0) this.skills.cancelRepeat();
    this.skills.step(dt, cmd);
    this.ball.set(m.ball.position.x, m.ball.position.y, m.ball.position.z);
    let footDistance = Infinity;
    for (const side of ['L', 'R'] as const) {
      if (p.model.toePosition?.(this.toe, side)) footDistance = Math.min(footDistance, this.toe.distanceTo(this.ball));
    }
    if (!Number.isFinite(footDistance)) footDistance = m.footPoint(p, this.toe).setY(this.ball.y).distanceTo(this.ball);
    const sample: TelemetrySample = {
      time: m.elapsed, dt, controlled: playerId(p)!, input: [cmd.move.x, cmd.move.z],
      playerVelocity: vector(p.vel), facing: [p.facing.x, p.facing.z], ballVelocity: vector(m.ball.velocity),
      footDistance, owned: m.ball.owner === p,
      intentionalKick: m.events.some((e) => e.type === 'kick' && e.player === p),
      touches: m.events.filter((e) => e.type === 'touch' && e.player === p).length,
      heavyTouches: m.events.filter((e) => e.type === 'heavyTouch' && e.player === p).length,
      motionId: p.model.currentMotionId ?? null, hipsHeight: p.model.hipsHeight ?? null,
    };
    const result = updateTelemetry(this.state, sample);
    this.state = result.state;
    this.latest = result.metrics;
    this.history = recentHistory([...this.history, result.metrics], m.elapsed);
    const { move: _move, ...buttons } = cmd;
    // 설정이 바뀔 때만 새 스냅샷을 만들어 과거 행의 설정을 보존한다.
    if ((Object.keys(settings) as (keyof typeof settings)[]).some((key) => settings[key] !== this.settingsSnapshot[key])) this.settingsSnapshot = { ...settings };
    const record = {
      time: m.elapsed, dt, scenario: this.scenarios.current, seed: this.scenarios.seed,
      input: { ...buttons, move: [...sample.input], skillMove: cmd.skillMove ? vector(cmd.skillMove) : undefined },
      state: {
        controlled: playerId(p), owner: playerId(m.ball.owner), lastTouch: playerId(m.ball.lastTouch), phase: m.phase,
        ballPosition: vector(m.ball.position), ballVelocity: vector(m.ball.velocity), charge: m.charge ? { ...m.charge } : null,
        players: m.players.map((q) => ({ id: playerId(q), position: vector(q.pos), velocity: vector(q.vel), facing: vector(q.facing), tackleTimer: q.tackleTimer, diveTimer: q.diveTimer, motionId: q.model.currentMotionId ?? null, hipsHeight: q.model.hipsHeight ?? null })),
      },
      events: { touches: sample.touches, heavyTouches: sample.heavyTouches, intentionalKick: sample.intentionalKick },
      telemetry: result.metrics, parameters: this.parameters, settings: this.settingsSnapshot,
    };
    const capacity = Math.ceil(PLAYGROUND.recordSeconds / PHYSICS.step);
    if (this.recordBuffer.length < capacity) this.recordBuffer.push(record);
    else {
      this.recordBuffer[this.recordHead] = record;
      this.recordHead = (this.recordHead + 1) % capacity;
    }
    // 이벤트는 고정 스텝별로 소비해 여러 스텝이 한 화면 프레임에 들어와도 중복 집계하지 않는다.
    if (m.elapsed >= this.nextRender || !this.running) {
      this.render();
      this.nextRender = m.elapsed + PLAYGROUND.panelPeriod;
    }
  }

  private syncParameters(): void {
    this.parameters = parameterSnapshot();
    for (const p of PLAYGROUND_PARAMETERS) {
      const value = p.key === 'windup' ? this.parameters.MOTION_SELECT.windup : this.parameters.DRIBBLE[p.key];
      this.root.querySelector<HTMLInputElement>(`[data-param="${p.key}"]`)!.value = String(value);
      this.root.querySelector(`[data-value="${p.key}"]`)!.textContent = value.toFixed(2);
    }
  }

  private render(): void {
    this.output.textContent = this.scriptProgress !== null ? `스크립트 계산 중 · ${Math.floor(this.scriptProgress * 100)}%` : `${this.match.elapsed.toFixed(2)}s · ${this.recordBuffer.length} 스텝 · ${this.running ? '조작 중' : `${this.match.phase} · R로 다시 시작해요`}${this.latest?.turnPending ? ' · 방향 전환 측정 중' : ''}`;
    this.root.querySelector('#pg-motion')!.textContent = this.latest?.motionId ?? '이동 / 대기';
    for (const [key] of metrics) {
      const value = this.latest?.[key];
      this.root.querySelector(`[data-metric="${key}"]`)!.textContent = value === null || value === undefined ? '—' : value.toFixed(3);
      const canvas = this.root.querySelector<HTMLCanvasElement>(`[data-graph="${key}"]`)!;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const values = this.history.map((row) => row[key]).filter((v): v is number => v !== null);
      if (!values.length) continue;
      const min = Math.min(...values), span = Math.max(0.001, Math.max(...values) - min);
      ctx.strokeStyle = '#5ce6b2';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let gap = true;
      for (const row of this.history) {
        const value = row[key];
        if (value === null) { gap = true; continue; }
        const x = canvas.width * (1 - (this.match.elapsed - row.time) / PLAYGROUND.historySeconds);
        const y = canvas.height - 2 - (value - min) / span * (canvas.height - 4);
        if (gap) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        gap = false;
      }
      ctx.stroke();
    }
  }

  private async copyParameters(): Promise<void> {
    const text = JSON.stringify(parameterSnapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.output.textContent = '현재 파라미터를 JSON으로 복사했어요.';
    } catch {
      const textarea = this.root.querySelector<HTMLTextAreaElement>('#pg-values')!;
      textarea.hidden = false;
      textarea.value = text;
      textarea.focus();
      textarea.select();
      this.output.textContent = '아래 JSON을 선택하면 복사할 수 있어요.';
    }
  }

  private download(format: 'json' | 'csv'): void {
    const text = format === 'json' ? JSON.stringify({ version: 1, records: this.records }, null, 2) : recordsToCsv(this.records);
    const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `playground-${this.scenarios.current}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
