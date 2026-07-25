import { FIELD, MAX_ROUNDS } from '../core/constants';
import type { GameMap } from '../core/map';
import { role } from '../core/roles';
import { dist, isInvisible, isUltActive } from '../core/rules';
import type { Actor, World } from '../core/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const fmt = (s: number): string => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
};

/** How far a runner can see the defenders without a radar or a Scout on the team. */
const SIGHT = 26;

export class Hud {
  private timer = $('timer');
  private phase = $('phase');
  private pips = $('pips');
  private banner = $('banner');
  private feed = $<HTMLUListElement>('feed');
  private roster = $('roster');
  private stamina = $('stamina');
  private charge = $('charge');
  private chargeTrack = this.charge.parentElement as HTMLElement;
  private roleName = $('role-name');
  private roleSide = $('role-side');
  private ultLabel = $('ult-label');
  private scoreBlue = $('score-blue').querySelector('b') as HTMLElement;
  private scoreRed = $('score-red').querySelector('b') as HTMLElement;
  private map = $<HTMLCanvasElement>('minimap');
  private ctx = this.map.getContext('2d') as CanvasRenderingContext2D;

  private feedSeen = 0;
  private bannerUntil = 0;
  private lastBanner = '';

  constructor(private gameMap: GameMap) {}

  update(w: World, player: Actor | undefined): void {
    // --- clock and phase
    if (w.phase === 'lineup') {
      this.timer.textContent = fmt(w.lineupClock);
      this.phase.textContent = 'Line-up';
    } else {
      this.timer.textContent = fmt(w.roundClock);
      this.phase.textContent = w.phase === 'live' ? `Round ${w.roundIndex + 1}` : 'Round over';
    }
    this.timer.classList.toggle('urgent', w.phase === 'live' && w.roundClock <= 15);

    // --- round pips
    if (this.pips.childElementCount !== MAX_ROUNDS) {
      this.pips.innerHTML = Array.from({ length: MAX_ROUNDS }, () => '<i></i>').join('');
    }
    Array.from(this.pips.children).forEach((el, i) => {
      const r = w.results[i];
      el.className = r ? r.winner : i === w.roundIndex && w.phase !== 'matchover' ? 'live' : '';
    });

    this.scoreBlue.textContent = String(w.wins.blue);
    this.scoreRed.textContent = String(w.wins.red);

    // --- banner
    if (w.banner && w.banner !== this.lastBanner) {
      this.lastBanner = w.banner;
      this.bannerUntil = w.t + (w.phase === 'lineup' ? 3.5 : 2);
      (this.banner.querySelector('span') as HTMLElement).textContent = w.banner;
      (this.banner.querySelector('small') as HTMLElement).textContent = w.subBanner;
    }
    this.banner.classList.toggle('show', w.t < this.bannerUntil && w.phase !== 'roundover');

    // --- feed
    while (this.feedSeen < w.events.length) {
      const ev = w.events[this.feedSeen++];
      if (ev.kind === 'roundstart' || ev.kind === 'roundend') continue;
      const li = document.createElement('li');
      li.className = ev.kind;
      li.textContent = ev.text;
      this.feed.prepend(li);
      while (this.feed.childElementCount > 5) this.feed.lastElementChild?.remove();
    }

    // --- player bars
    if (player) {
      const def = role(player.role);
      this.roleName.textContent = def.name;
      this.roleSide.textContent = player.side === 'runner' ? 'Runner' : 'Defender';
      this.ultLabel.textContent = def.ultName;
      this.stamina.style.width = `${(player.stamina / def.staminaMax) * 100}%`;
      const pct = isUltActive(w, player)
        ? ((player.ultUntil - w.t) / def.ultDur) * 100
        : (player.charge / def.ultCost) * 100;
      this.charge.style.width = `${Math.min(100, pct)}%`;
      this.chargeTrack.classList.toggle(
        'ready',
        player.charge >= def.ultCost || isUltActive(w, player),
      );
    }

    this.drawRoster(w, player);
    this.drawMinimap(w, player);
  }

  /** Reset transient UI between rounds. */
  resetFeed(w: World): void {
    this.feed.innerHTML = '';
    this.feedSeen = w.events.length;
    this.lastBanner = '';
  }

  private drawRoster(w: World, player: Actor | undefined): void {
    const runners = w.actors.filter((a) => a.side === 'runner');
    if (this.roster.childElementCount !== runners.length) {
      this.roster.innerHTML = runners.map(() => '<div class="chip"></div>').join('');
    }
    runners.forEach((r, i) => {
      const el = this.roster.children[i] as HTMLElement;
      el.className = `chip ${r.state}${player && r.id === player.id ? ' me' : ''}`;
      el.innerHTML = `<span>${r.name}</span><span style="opacity:.55">${
        role(r.role).name
      }</span><span class="st"></span>`;
    });
  }

  private drawMinimap(w: World, player: Actor | undefined): void {
    const c = this.ctx;
    const W = this.map.width;
    const H = this.map.height;
    const pad = 9;
    const fw = FIELD.halfW * 2;
    const fh = FIELD.safeBack - FIELD.baseBack;
    // Sim +x is screen-right in 3D, so the minimap uses the same orientation.
    const px = (x: number) => pad + ((x + FIELD.halfW) / fw) * (W - pad * 2);
    const py = (y: number) => H - pad - ((y - FIELD.baseBack) / fh) * (H - pad * 2);

    c.clearRect(0, 0, W, H);

    c.fillStyle = 'rgba(118,166,63,0.22)';
    c.fillRect(px(-FIELD.halfW), py(FIELD.safeBack), W - pad * 2, py(FIELD.baseBack) - py(FIELD.safeBack));

    c.fillStyle = 'rgba(232,199,101,0.35)';
    c.fillRect(px(-FIELD.halfW), py(FIELD.safeBack), W - pad * 2, py(FIELD.safeFront) - py(FIELD.safeBack));

    c.fillStyle = 'rgba(185,138,82,0.35)';
    c.fillRect(px(-FIELD.halfW), py(FIELD.baseFront), W - pad * 2, py(FIELD.baseBack) - py(FIELD.baseFront));

    // terrain
    for (const o of this.gameMap.obstacles) {
      if (o.shape === 'box') {
        c.fillStyle = 'rgba(216,201,164,0.5)';
        c.fillRect(
          px(o.x - o.hw),
          py(o.y + o.hh),
          px(o.x + o.hw) - px(o.x - o.hw),
          py(o.y - o.hh) - py(o.y + o.hh),
        );
      } else {
        c.beginPath();
        c.arc(px(o.x), py(o.y), Math.max(1.5, (o.r / fw) * (W - pad * 2)), 0, Math.PI * 2);
        c.fillStyle =
          o.kind === 'pond'
            ? 'rgba(61,127,166,0.55)'
            : o.kind === 'mud'
              ? 'rgba(109,84,51,0.55)'
              : 'rgba(47,112,44,0.5)';
        c.fill();
      }
    }

    // defender lines
    c.strokeStyle = 'rgba(201,167,106,0.75)';
    c.lineWidth = 1.5;
    for (const ly of FIELD.lines) {
      c.beginPath();
      c.moveTo(px(-FIELD.halfW), py(ly));
      c.lineTo(px(FIELD.halfW), py(ly));
      c.stroke();
    }

    // bamboo barriers
    c.strokeStyle = '#d8ab55';
    c.lineWidth = 3;
    for (const wall of w.walls) {
      c.beginPath();
      c.moveTo(px(wall.x - wall.halfLen), py(wall.y));
      c.lineTo(px(wall.x + wall.halfLen), py(wall.y));
      c.stroke();
    }

    // signal pings
    for (const p of w.pings) {
      const k = 1 - (p.until - w.t) / 5;
      c.beginPath();
      c.arc(px(p.x), py(p.y), 3 + ((k * 3) % 1) * 9, 0, Math.PI * 2);
      c.strokeStyle = p.team === 'blue' ? 'rgba(126,200,255,0.8)' : 'rgba(255,138,114,0.8)';
      c.lineWidth = 1.5;
      c.stroke();
    }

    const radar = w.radarUntil > w.t;
    const scoutOnTeam =
      !!player &&
      w.actors.some((a) => a.team === player.team && a.role === 'scout' && a.state !== 'caught');

    for (const a of w.actors) {
      if (a.state === 'caught' && a.side === 'runner') continue;

      if (a.side === 'catcher' && player?.side === 'runner') {
        const seen = radar || scoutOnTeam || (player && dist(player.pos, a.pos) < SIGHT);
        if (!seen) continue;
      }
      if (a.side === 'runner' && player?.side === 'catcher' && isInvisible(w, a)) continue;

      const r = a.isPlayer ? 4.5 : 3.2;
      c.beginPath();
      c.arc(px(a.pos.x), py(a.pos.y), r, 0, Math.PI * 2);
      c.fillStyle = a.isPlayer
        ? '#ffd166'
        : a.side === 'runner'
          ? a.state === 'safe'
            ? '#6ee787'
            : '#4aa3ff'
          : '#ff6a52';
      c.fill();

      if (a.isPlayer) {
        c.strokeStyle = 'rgba(255,209,102,0.6)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(px(a.pos.x), py(a.pos.y), 8, 0, Math.PI * 2);
        c.stroke();
      }
      if (a.campPenalty > 0.05) {
        c.strokeStyle = 'rgba(255,166,0,0.85)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(px(a.pos.x), py(a.pos.y), 6.5, 0, Math.PI * 2);
        c.stroke();
      }
    }
  }
}
