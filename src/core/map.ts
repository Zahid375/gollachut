import { FIELD, VAULT_MAX_R } from './constants';
import type { Vec2 } from './types';

export type ObstacleKind = 'tree' | 'palm' | 'haystack' | 'pot' | 'house' | 'pond' | 'mud';

export interface CircleObstacle {
  shape: 'circle';
  kind: Exclude<ObstacleKind, 'house'>;
  x: number;
  y: number;
  r: number;
  /** 0 = solid. >0 = passable but multiplies speed by this factor. */
  drag: number;
  /** Cosmetic seed so the renderer can vary height/rotation deterministically. */
  seed: number;
}

export interface BoxObstacle {
  shape: 'box';
  kind: 'house';
  x: number;
  y: number;
  hw: number;
  hh: number;
  drag: 0;
  seed: number;
}

export type Obstacle = CircleObstacle | BoxObstacle;

export interface GameMap {
  id: string;
  name: string;
  blurb: string;
  obstacles: Obstacle[];
}

/** Small deterministic PRNG so the map (and its visuals) are identical every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keeps a lane of clear ground on each defender line so tagging stays readable. */
const LINE_CLEARANCE = 4.0;

function clearOfLines(y: number, pad: number): boolean {
  return FIELD.lines.every((ly) => Math.abs(y - ly) > LINE_CLEARANCE + pad);
}

export function buildVillageMap(): GameMap {
  const rnd = mulberry32(0x9011ac);
  const obstacles: Obstacle[] = [];

  const fits = (x: number, y: number, r: number) => {
    if (Math.abs(x) > FIELD.halfW - r - 0.5) return false;
    if (y < FIELD.baseFront + 3 || y > FIELD.safeFront - 3) return false;
    if (!clearOfLines(y, r)) return false;
    return obstacles.every((o) => {
      const rr = o.shape === 'circle' ? o.r : Math.max(o.hw, o.hh);
      return Math.hypot(o.x - x, o.y - y) > rr + r + 2.2;
    });
  };

  const place = (
    kind: ObstacleKind,
    r: number,
    drag: number,
    tries: number,
    band?: [number, number],
  ) => {
    for (let i = 0; i < tries * 14 && i < 400; i++) {
      const x = (rnd() * 2 - 1) * (FIELD.halfW - r - 1);
      const lo = band ? band[0] : FIELD.baseFront + 3;
      const hi = band ? band[1] : FIELD.safeFront - 3;
      const y = lo + rnd() * (hi - lo);
      if (!fits(x, y, r)) continue;
      obstacles.push({ shape: 'circle', kind: kind as CircleObstacle['kind'], x, y, r, drag, seed: rnd() });
      if (obstacles.filter((o) => o.kind === kind).length >= tries) return;
    }
  };

  // Bamboo houses flank the mid-field so the middle lines have hard cover.
  const houses: Array<[number, number, number, number]> = [
    [-18, 24, 4.2, 3.2],
    [17.5, 40.5, 3.6, 3.0],
    [-16, 56, 3.9, 3.1],
    [19, 10.5, 3.4, 2.8],
  ];
  for (const [x, y, hw, hh] of houses) {
    obstacles.push({ shape: 'box', kind: 'house', x, y, hw, hh, drag: 0, seed: rnd() });
  }

  // The village pond — crossable, but it costs you speed.
  obstacles.push({ shape: 'circle', kind: 'pond', x: 4.5, y: 40, r: 6.4, drag: 0.55, seed: rnd() });
  // Paddy mud patches near the last line: the classic late-run trap.
  obstacles.push({ shape: 'circle', kind: 'mud', x: -9, y: 72, r: 5.0, drag: 0.68, seed: rnd() });
  obstacles.push({ shape: 'circle', kind: 'mud', x: 13, y: 71, r: 4.2, drag: 0.7, seed: rnd() });

  place('tree', 1.0, 0, 9);
  place('palm', 0.85, 0, 6);
  place('haystack', 1.25, 0, 6);
  place('pot', 0.65, 0, 5, [FIELD.baseFront + 4, 30]);

  return {
    id: 'village',
    name: 'Village',
    blurb: 'Narrow dirt roads, bamboo houses, a pond in the middle and mud before the safe zone.',
    obstacles,
  };
}

export function isVaultable(o: Obstacle): boolean {
  return o.shape === 'circle' && o.drag === 0 && o.r <= VAULT_MAX_R;
}

/** Speed multiplier from any drag zones the actor is standing in. */
export function terrainDrag(map: GameMap, p: Vec2): number {
  let mul = 1;
  for (const o of map.obstacles) {
    if (o.shape !== 'circle' || o.drag <= 0) continue;
    if (Math.hypot(o.x - p.x, o.y - p.y) < o.r) mul = Math.min(mul, o.drag);
  }
  return mul;
}

/**
 * Pushes `p` out of every solid obstacle it overlaps. Mutates `p`.
 * `vaulting` lets an actor mid-hop pass through small props.
 */
export function resolveCollisions(map: GameMap, p: Vec2, radius: number, vaulting: boolean): void {
  for (const o of map.obstacles) {
    if (o.drag > 0) continue;
    if (vaulting && isVaultable(o)) continue;

    if (o.shape === 'circle') {
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      const min = o.r + radius;
      if (d < min && d > 1e-6) {
        p.x = o.x + (dx / d) * min;
        p.y = o.y + (dy / d) * min;
      } else if (d <= 1e-6) {
        p.x = o.x + min;
      }
    } else {
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const ox = o.hw + radius - Math.abs(dx);
      const oy = o.hh + radius - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        if (ox < oy) p.x += Math.sign(dx || 1) * ox;
        else p.y += Math.sign(dy || 1) * oy;
      }
    }
  }
}

/** True if a straight segment from a to b is blocked — used by runner bots to pick gaps. */
export function pathBlocked(map: GameMap, a: Vec2, b: Vec2, radius: number): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (const o of map.obstacles) {
      if (o.drag > 0) continue;
      if (o.shape === 'circle') {
        if (Math.hypot(o.x - x, o.y - y) < o.r + radius) return true;
      } else if (Math.abs(x - o.x) < o.hw + radius && Math.abs(y - o.y) < o.hh + radius) {
        return true;
      }
    }
  }
  return false;
}
