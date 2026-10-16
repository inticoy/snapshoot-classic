import * as THREE from 'three';
import { MATCH, PITCH, TEAM_COLORS } from '../config';
import type { Match } from '../gameplay/Match';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private readonly root = $('hud');
  private readonly score = $('score');
  private readonly clock = $('clock');
  private readonly tag = $('player-tag');
  private readonly name = $('player-name');
  private readonly stamina = $('stamina');
  private readonly powerWrap = $('power-wrap');
  private readonly power = $('power');
  private readonly banner = $('banner');
  private readonly minimap = $<HTMLCanvasElement>('minimap');
  private readonly mm = this.minimap.getContext('2d')!;
  private bannerTimer = 0;
  private readonly proj = new THREE.Vector3();

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  flash(text: string, seconds = 2, small = false): void {
    this.banner.textContent = text;
    this.banner.classList.toggle('small', small);
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  update(dt: number, match: Match, camera: THREE.Camera): void {
    this.score.textContent = `${match.score[0]} - ${match.score[1]}`;
    const minute = Math.min(90, Math.floor((match.clock / MATCH.durationSeconds) * 90));
    this.clock.textContent = `${minute}'`;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }

    // 조종 중인 선수 머리 위 정보
    const p = match.controlled;
    this.proj.set(p.pos.x, 2.25, p.pos.z).project(camera);
    const visible = this.proj.z < 1 && match.phase !== 'goal';
    this.tag.style.display = visible ? 'flex' : 'none';
    if (visible) {
      this.tag.style.left = `${((this.proj.x + 1) / 2) * window.innerWidth}px`;
      this.tag.style.top = `${((1 - this.proj.y) / 2) * window.innerHeight}px`;
      this.name.textContent = `${p.number} ${p.name}`;
      this.stamina.style.width = `${p.stamina * 100}%`;
      this.stamina.style.background = p.stamina < 0.3 ? '#e84855' : '#5bd38a';
      const charge = match.charge;
      this.powerWrap.style.visibility = charge ? 'visible' : 'hidden';
      if (charge) this.power.style.width = `${charge.value * 100}%`;
    }

    this.drawMinimap(match);
  }

  private drawMinimap(match: Match): void {
    const g = this.mm;
    const W = this.minimap.width, H = this.minimap.height;
    const pad = 6;
    const sx = (W - pad * 2) / PITCH.length;
    const sz = (H - pad * 2) / PITCH.width;
    const X = (x: number) => pad + (x + PITCH.halfL) * sx;
    const Z = (z: number) => pad + (z + PITCH.halfW) * sz;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1;
    g.strokeRect(X(-PITCH.halfL), Z(-PITCH.halfW), PITCH.length * sx, PITCH.width * sz);
    g.beginPath();
    g.moveTo(X(0), Z(-PITCH.halfW));
    g.lineTo(X(0), Z(PITCH.halfW));
    g.stroke();
    for (const s of [-1, 1]) {
      const x0 = X(s * PITCH.halfL), x1 = X(s * (PITCH.halfL - PITCH.boxDepth));
      g.strokeRect(Math.min(x0, x1), Z(-PITCH.boxWidth / 2), Math.abs(x1 - x0), PITCH.boxWidth * sz);
    }
    for (const p of match.players) {
      g.beginPath();
      g.arc(X(p.pos.x), Z(p.pos.z), p === match.controlled ? 4.5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = p.isKeeper ? `#${TEAM_COLORS[p.team].keeper.toString(16).padStart(6, '0')}` : TEAM_COLORS[p.team].ui;
      g.fill();
      if (p === match.controlled) {
        g.strokeStyle = '#f2c230';
        g.lineWidth = 2;
        g.stroke();
      }
    }
    const b = match.ball.position;
    g.beginPath();
    g.arc(X(b.x), Z(b.z), 2.5, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.stroke();
  }
}
