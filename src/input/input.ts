import { emptyInput, type PlayerInput } from '../core/types';

type Edge = 'jump' | 'juke' | 'signal' | 'ult';

const KEY_MOVE: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const KEY_EDGE: Record<string, Edge> = {
  Space: 'jump',
  KeyQ: 'juke',
  KeyE: 'signal',
  KeyF: 'ult',
};

const STICK_RADIUS = 62;

/**
 * Merges keyboard and touch into one PlayerInput. Ability presses are edge-triggered
 * and consumed by `read()`, so a held key fires once.
 */
export class InputSource {
  private keys = new Set<string>();
  private edges = new Set<Edge>();
  private stick = { x: 0, y: 0 };
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private touchHold = new Set<'sprint'>();
  private enabled = true;

  constructor(
    private stickBase: HTMLElement,
    private stickKnob: HTMLElement,
    touchRoot: HTMLElement,
  ) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (!this.enabled) return;
      if (KEY_MOVE[e.code] || KEY_EDGE[e.code] || e.code.startsWith('Shift')) e.preventDefault();
      this.keys.add(e.code);
      const edge = KEY_EDGE[e.code];
      if (edge) this.edges.add(edge);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // --- floating joystick on the left half of the screen
    touchRoot.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.act) return;
      if (e.clientX > innerWidth * 0.55) return;
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      stickBase.style.display = 'block';
      stickBase.style.left = `${e.clientX}px`;
      stickBase.style.top = `${e.clientY}px`;
      this.moveKnob(0, 0);
      touchRoot.setPointerCapture(e.pointerId);
    });

    touchRoot.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      this.moveKnob(dx * k, dy * k);
      this.stick.x = (dx * k) / STICK_RADIUS;
      this.stick.y = -(dy * k) / STICK_RADIUS; // screen up = toward the safe zone
    });

    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stick.x = 0;
      this.stick.y = 0;
      stickBase.style.display = 'none';
    };
    touchRoot.addEventListener('pointerup', endStick);
    touchRoot.addEventListener('pointercancel', endStick);

    // --- action buttons
    for (const btn of Array.from(touchRoot.querySelectorAll<HTMLElement>('[data-act]'))) {
      const act = btn.dataset.act as Edge | 'sprint';
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('down');
        if (act === 'sprint') this.touchHold.add('sprint');
        else this.edges.add(act);
      });
      const up = (e: PointerEvent) => {
        e.preventDefault();
        btn.classList.remove('down');
        if (act === 'sprint') this.touchHold.delete('sprint');
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  private moveKnob(dx: number, dy: number): void {
    this.stickKnob.style.transform = `translate(${dx - 26}px, ${dy - 26}px)`;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.edges.clear();
      this.stick.x = 0;
      this.stick.y = 0;
      this.stickId = null;
      this.stickBase.style.display = 'none';
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  read(): PlayerInput {
    const inp = emptyInput();
    if (!this.enabled) return inp;

    for (const code of this.keys) {
      const v = KEY_MOVE[code];
      if (v) {
        inp.move.x += v[0];
        inp.move.y += v[1];
      }
    }
    inp.move.x += this.stick.x;
    inp.move.y += this.stick.y;

    const len = Math.hypot(inp.move.x, inp.move.y);
    if (len > 1) {
      inp.move.x /= len;
      inp.move.y /= len;
    }

    inp.sprint =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchHold.has('sprint');

    inp.jump = this.edges.has('jump');
    inp.juke = this.edges.has('juke');
    inp.signal = this.edges.has('signal');
    inp.ult = this.edges.has('ult');
    this.edges.clear();

    return inp;
  }
}
