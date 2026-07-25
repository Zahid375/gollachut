import { FIELD, LANE_LEAN } from './constants';
import { role } from './roles';
import type { Actor, TeamId, Vec2, Wall, World } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

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

export function tagRadius(w: World, a: Actor): number {
  const base = role(a.role).tagR;
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

/** Bamboo barriers are solid segments sitting on a defender line. */
export function wallAt(w: World, x: number, y: number, pad: number): Wall | null {
  for (const wall of liveWalls(w)) {
    if (Math.abs(y - wall.y) < 0.9 + pad && Math.abs(x - wall.x) < wall.halfLen + pad) return wall;
  }
  return null;
}

export function clampToField(p: Vec2, r: number): void {
  p.x = clamp(p.x, -FIELD.halfW + r, FIELD.halfW - r);
  p.y = clamp(p.y, FIELD.baseBack + r, FIELD.safeBack - r);
}

export function clampToLane(a: Actor, r: number): void {
  const ly = laneY(a);
  a.pos.y = clamp(a.pos.y, ly - LANE_LEAN, ly + LANE_LEAN);
  a.pos.x = clamp(a.pos.x, -FIELD.halfW + r, FIELD.halfW - r);
}

/** The next defender line a runner still has to cross, or null if all are behind them. */
export function nextLineY(y: number): number | null {
  for (const ly of FIELD.lines) if (ly > y + 0.4) return ly;
  return null;
}

export function lineIndexOf(y: number): number {
  return FIELD.lines.findIndex((ly) => ly > y + 0.4);
}
