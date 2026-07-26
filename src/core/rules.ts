import { FIELD, LANE_LEAN } from './constants';
import { DIFFICULTIES, NEUTRAL, type DifficultyDef } from './difficulty';
import { role } from './roles';
import type { Actor, TeamId, Vec2, Wall, World } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Math.hypot is several times slower than an inline sqrt and these run thousands of
// times per tick, so the hot-path helpers avoid it.
export const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist = (a: Vec2, b: Vec2) => len2(a.x - b.x, a.y - b.y);
/** Squared distance — use whenever the result is only compared against a threshold. */
export const dist2 = (a: Vec2, b: Vec2) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function laneY(a: Actor): number {
  return FIELD.lines[clamp(a.lane, 0, FIELD.lines.length - 1)];
}

export function isUltActive(w: World, a: Actor): boolean {
  return a.ultUntil > w.t;
}

/** Trickster's Vanish: defenders (and their bots) cannot see this runner. */
export function isInvisible(w: World, a: Actor): boolean {
  return a.role === 'trickster' && isUltActive(w, a);
}

/**
 * Difficulty settings apply to opposing bots only — never the player, never their
 * team-mates. Everyone else plays at Medium.
 */
export function isOpponent(w: World, a: Actor): boolean {
  return !a.isPlayer && a.team !== w.playerTeam;
}

export function aiTuning(w: World, a: Actor): DifficultyDef {
  return isOpponent(w, a) ? DIFFICULTIES[w.difficulty] : NEUTRAL;
}

/** Speed multiplier for this actor: 1.0 for the player and their team-mates. */
export function aiSpeed(w: World, a: Actor): number {
  const tune = aiTuning(w, a);
  return a.side === 'catcher' ? tune.catcherSpeed : tune.runnerSpeed;
}

export function tagRadius(w: World, a: Actor): number {
  const base = role(a.role).tagR * aiTuning(w, a).catcherTagR;
  if (a.role === 'hunter' && isUltActive(w, a)) return base + 1.15;
  return base;
}

export function activeRunners(w: World): Actor[] {
  return w.actors.filter((a) => a.side === 'runner' && a.state === 'active');
}

export function catchers(w: World): Actor[] {
  return w.actors.filter((a) => a.side === 'catcher');
}

export function runnerTeam(w: World): TeamId {
  return w.sides.blue === 'runner' ? 'blue' : 'red';
}

export function catcherTeam(w: World): TeamId {
  return w.sides.blue === 'runner' ? 'red' : 'blue';
}

export function liveWalls(w: World): Wall[] {
  return w.walls.filter((wall) => wall.until > w.t);
}

/**
 * Bamboo barriers are solid segments sitting on a defender line.
 * Iterates `w.walls` directly — `step()` already prunes expired ones each tick, and this
 * runs per actor per tick, so allocating a filtered copy here is pure garbage.
 */
export function wallAt(w: World, x: number, y: number, pad: number): Wall | null {
  for (const wall of w.walls) {
    if (wall.until <= w.t) continue;
    if (Math.abs(y - wall.y) < 0.9 + pad && Math.abs(x - wall.x) < wall.halfLen + pad) return wall;
  }
  return null;
}

export function clampToField(p: Vec2, r: number): void {
  p.x = clamp(p.x, -FIELD.halfW + r, FIELD.halfW - r);
  p.y = clamp(p.y, FIELD.baseBack + r, FIELD.safeBack - r);
}

/**
 * Defenders own one line and may only lean LANE_LEAN off it — the traditional rule.
 * Velocity is killed at the boundary rather than left pushing into it, so holding W at the
 * edge of your lane settles instead of grinding against an invisible wall.
 */
export function clampToLane(a: Actor, r: number): void {
  const ly = laneY(a);
  const lo = ly - LANE_LEAN;
  const hi = ly + LANE_LEAN;
  if (a.pos.y < lo) {
    a.pos.y = lo;
    if (a.vel.y < 0) a.vel.y = 0;
  } else if (a.pos.y > hi) {
    a.pos.y = hi;
    if (a.vel.y > 0) a.vel.y = 0;
  }

  const edge = FIELD.halfW - r;
  if (a.pos.x < -edge) {
    a.pos.x = -edge;
    if (a.vel.x < 0) a.vel.x = 0;
  } else if (a.pos.x > edge) {
    a.pos.x = edge;
    if (a.vel.x > 0) a.vel.x = 0;
  }
}

/** The next defender line a runner still has to cross, or null if all are behind them. */
export function nextLineY(y: number): number | null {
  for (const ly of FIELD.lines) if (ly > y + 0.4) return ly;
  return null;
}

export function lineIndexOf(y: number): number {
  return FIELD.lines.findIndex((ly) => ly > y + 0.4);
}
