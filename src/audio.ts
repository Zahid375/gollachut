// Synthesised game audio. Everything here is generated with WebAudio oscillators and
// noise buffers, so the game ships no audio assets and nothing has to be preloaded.
//
// Browsers refuse to start an AudioContext outside a user gesture, so the context is not
// created until `unlock()` is called from a real click. Every sound is a no-op before that.

import type { Actor, World } from './core/types';
import type { Weather } from './render/village';

const STORAGE_KEY = 'gollachut.sound';

interface Nodes {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  bed: GainNode;
  noise: AudioBuffer;
}

interface ToneOpts {
  from: number;
  to?: number;
  type?: OscillatorType;
  dur: number;
  gain: number;
  delay?: number;
  /** Attack in seconds. Short = percussive, longer = a swell. */
  attack?: number;
}

class GameAudio {
  private n: Nodes | null = null;
  private unlocked = false;
  private _muted = false;

  /** Last game event turned into a sound. Ids are monotonic, so this cannot desync. */
  private lastEventId = -1;
  /** Distance the player has run since the last footstep. */
  private stepDist = 0;
  private lastCountdown = -1;
  private lastPhase = '';
  /** Ability timers last seen on the player, so a fresh dodge/hop can be detected. */
  private lastJuke = 0;
  private lastVault = 0;
  private ambience: { gain: GainNode; filter: BiquadFilterNode } | null = null;

  constructor() {
    try {
      this._muted = localStorage.getItem(STORAGE_KEY) === 'off';
    } catch {
      this._muted = false;
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Call from a click handler. Until this runs, every sound is silently skipped. */
  unlock(): void {
    this.unlocked = true;
    const n = this.ensure();
    if (n && n.ctx.state === 'suspended') void n.ctx.resume();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    try {
      localStorage.setItem(STORAGE_KEY, m ? 'off' : 'on');
    } catch {
      /* private browsing — the setting just will not persist */
    }
    if (this.n) this.n.master.gain.value = m ? 0 : 1;
  }

  toggleMute(): boolean {
    this.setMuted(!this._muted);
    return this._muted;
  }

  private ensure(): Nodes | null {
    if (this.n) return this.n;
    if (!this.unlocked) return null;
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();

      const master = ctx.createGain();
      master.gain.value = this._muted ? 0 : 1;
      master.connect(ctx.destination);

      const sfx = ctx.createGain();
      sfx.gain.value = 0.85;
      sfx.connect(master);

      const bed = ctx.createGain();
      bed.gain.value = 0.5;
      bed.connect(master);

      // Two seconds of brown-ish noise, reused for every whoosh, thud and the wind bed.
      const len = ctx.sampleRate * 2;
      const noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }

      this.n = { ctx, master, sfx, bed, noise };
      this.startAmbience();
    } catch {
      this.n = null;
    }
    return this.n;
  }

  // ------------------------------------------------------------- primitives

  private tone(o: ToneOpts): void {
    const n = this.ensure();
    if (!n) return;
    const t = n.ctx.currentTime + (o.delay ?? 0);
    const osc = n.ctx.createOscillator();
    const g = n.ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    if (o.to && o.to !== o.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
    }
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    g.connect(n.sfx);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  private noiseBurst(
    freq: number,
    q: number,
    dur: number,
    gain: number,
    delay = 0,
    sweepTo?: number,
  ): void {
    const n = this.ensure();
    if (!n) return;
    const t = n.ctx.currentTime + delay;
    const src = n.ctx.createBufferSource();
    src.buffer = n.noise;
    src.loop = true;
    const f = n.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
    f.Q.value = q;
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(n.sfx);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------ the ambience

  private startAmbience(): void {
    const n = this.n;
    if (!n || this.ambience) return;
    const src = n.ctx.createBufferSource();
    src.buffer = n.noise;
    src.loop = true;

    const filter = n.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    const gain = n.ctx.createGain();
    gain.gain.value = 0.1;

    // Slow swell so the wind breathes instead of sitting as flat hiss.
    const lfo = n.ctx.createOscillator();
    const lfoGain = n.ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.045;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();

    src.connect(filter);
    filter.connect(gain);
    gain.connect(n.bed);
    src.start();
    this.ambience = { gain, filter };
  }

  /** Rain gets a brighter, louder bed; sunset is calmer than midday. */
  setWeather(w: Weather): void {
    const a = this.ambience;
    const n = this.n;
    if (!a || !n) return;
    const t = n.ctx.currentTime;
    const [freq, vol] = w === 'rain' ? [1800, 0.2] : w === 'sunset' ? [340, 0.07] : [420, 0.1];
    a.filter.frequency.setTargetAtTime(freq, t, 0.4);
    a.gain.gain.setTargetAtTime(vol, t, 0.4);
  }

  // ------------------------------------------------------------- one-shots

  click(): void {
    this.tone({ from: 600, to: 140, dur: 0.05, gain: 0.22 });
  }

  back(): void {
    this.tone({ from: 320, to: 130, dur: 0.09, gain: 0.2 });
  }

  /** Referee whistle: a shrill pair of tones with a breathy edge. */
  whistle(long = false): void {
    const d = long ? 0.55 : 0.28;
    this.tone({ from: 2050, to: 2150, type: 'sine', dur: d, gain: 0.14 });
    this.tone({ from: 2620, to: 2700, type: 'sine', dur: d, gain: 0.07 });
    this.noiseBurst(2400, 8, d, 0.05);
  }

  tag(): void {
    this.tone({ from: 190, to: 48, type: 'sine', dur: 0.22, gain: 0.4 });
    this.noiseBurst(320, 1.2, 0.16, 0.28);
  }

  safe(): void {
    this.tone({ from: 523, dur: 0.16, gain: 0.2, type: 'triangle' });
    this.tone({ from: 659, dur: 0.16, gain: 0.2, type: 'triangle', delay: 0.09 });
    this.tone({ from: 784, dur: 0.3, gain: 0.22, type: 'triangle', delay: 0.18 });
  }

  release(): void {
    this.tone({ from: 430, to: 660, dur: 0.11, gain: 0.16, type: 'triangle' });
  }

  ult(): void {
    this.tone({ from: 110, to: 460, type: 'sawtooth', dur: 0.5, gain: 0.16, attack: 0.12 });
    this.tone({ from: 220, to: 920, type: 'sine', dur: 0.5, gain: 0.1, attack: 0.12 });
  }

  signal(): void {
    this.tone({ from: 880, dur: 0.1, gain: 0.16 });
    this.tone({ from: 1320, dur: 0.16, gain: 0.13, delay: 0.08 });
  }

  camp(): void {
    this.tone({ from: 96, to: 74, type: 'square', dur: 0.32, gain: 0.09 });
  }

  juke(): void {
    this.noiseBurst(900, 2.2, 0.22, 0.2, 0, 2600);
  }

  vault(): void {
    this.noiseBurst(500, 1.6, 0.26, 0.16, 0, 1500);
    this.tone({ from: 300, to: 520, dur: 0.2, gain: 0.08, type: 'triangle' });
  }

  footstep(): void {
    const f = 150 + Math.random() * 70;
    this.noiseBurst(f, 1.1, 0.07, 0.075);
  }

  countdown(final: boolean): void {
    this.tone({ from: final ? 1320 : 880, dur: final ? 0.24 : 0.09, gain: 0.16, type: 'triangle' });
  }

  matchEnd(won: boolean): void {
    const notes = won ? [523, 659, 784, 1046] : [660, 550, 440, 330];
    notes.forEach((f, i) =>
      this.tone({ from: f, dur: 0.34, gain: 0.2, type: 'triangle', delay: i * 0.15 }),
    );
  }

  // ------------------------------------------------------------ frame driver

  /** Reset per-round cursors. Call when a round or match starts. */
  resync(w: World): void {
    this.lastEventId = w.eventSeq - 1;
    this.lastCountdown = -1;
    this.stepDist = 0;
    this.lastJuke = 0;
    this.lastVault = 0;
  }

  /**
   * Turns simulation state into sound: game events become one-shots, and the player's own
   * movement drives footsteps. Reads events by id for the same reason the HUD feed does —
   * `w.events` is capped and shifts, so an index cursor would silently stop firing.
   */
  update(w: World, player: Actor | undefined, dt: number): void {
    if (!this.n) return;

    for (const ev of w.events) {
      if (ev.id <= this.lastEventId) continue;
      this.lastEventId = ev.id;
      switch (ev.kind) {
        case 'caught': this.tag(); break;
        case 'safe': this.safe(); break;
        case 'released': this.release(); break;
        case 'ult': this.ult(); break;
        case 'signal': this.signal(); break;
        case 'camp': this.camp(); break;
        case 'roundstart': this.whistle(false); break;
        case 'roundend': this.whistle(true); break;
      }
    }

    // Line-up countdown over the last three seconds.
    if (w.phase === 'lineup') {
      const left = Math.ceil(w.lineupClock);
      if (left !== this.lastCountdown && left <= 3 && left >= 1) {
        this.lastCountdown = left;
        this.countdown(left === 1);
      }
    } else {
      this.lastCountdown = -1;
    }

    if (w.phase === 'matchover' && this.lastPhase !== 'matchover') {
      this.matchEnd(w.matchWinner === w.playerTeam);
    }
    this.lastPhase = w.phase;

    // Fake-move and vault are input actions rather than world events, so they are detected
    // from the ability timers jumping forward on the player.
    if (player) {
      if (player.jukeUntil > this.lastJuke) this.juke();
      this.lastJuke = player.jukeUntil;
      if (player.vaultUntil > this.lastVault) this.vault();
      this.lastVault = player.vaultUntil;
    }

    // Footsteps for the player only — one per stride of ground actually covered, so they
    // stay in step at any speed and stop dead when you do.
    if (player && (player.state === 'active' || player.side === 'catcher') && w.phase === 'live') {
      const speed = Math.sqrt(player.vel.x * player.vel.x + player.vel.y * player.vel.y);
      if (speed > 1.2) {
        this.stepDist += speed * dt;
        if (this.stepDist >= 1.9) {
          this.stepDist = 0;
          this.footstep();
        }
      } else {
        this.stepDist = 1.9; // next move triggers a step immediately
      }
    }
  }
}

export const audio = new GameAudio();

/** Kept for the existing global click handler. */
export function playClickSound(): void {
  audio.unlock();
  audio.click();
}
