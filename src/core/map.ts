import { FIELD, SLIP_MAX, SLIP_MIN_PUSH, VAULT_MAX_R } from './constants';
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

export type Footing = 'ground' | 'water' | 'mud';

/** What an actor is standing on, so footsteps can sound like the surface. */
export function footingAt(map: GameMap, p: Vec2): Footing {
  for (const o of map.obstacles) {
    if (o.shape !== 'circle' || o.drag <= 0) continue;
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    if (dx * dx + dy * dy < o.r * o.r) return o.kind === 'pond' ? 'water' : 'mud';
  }
  return 'ground';
}

/** Speed multiplier from any drag zones the actor is standing in. */
export function terrainDrag(map: GameMap, p: Vec2): number {
  let mul = 1;
  for (const o of map.obstacles) {
    if (o.shape !== 'circle' || o.drag <= 0) continue;
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    if (dx * dx + dy * dy < o.r * o.r) mul = Math.min(mul, o.drag);
  }
  return mul;
}

/**
 * Pushes `p` out of every solid obstacle it overlaps and, when `vel` is supplied, removes
 * the component of velocity pointing into the surface so the actor slides along it instead
 * of sticking. Mutates both. `vaulting` lets an actor mid-hop pass through small props.
 */
export function resolveCollisions(
  map: GameMap,
  p: Vec2,
  radius: number,
  vaulting: boolean,
  vel?: Vec2,
): void {
  for (const o of map.obstacles) {
    if (o.drag > 0) continue;
    if (vaulting && isVaultable(o)) continue;

    // Surface normal of the push, so velocity can be projected onto the tangent.
    let nx = 0;
    let ny = 0;

    if (o.shape === 'circle') {
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d2 = dx * dx + dy * dy;
      const min = o.r + radius;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-6) {
        nx = dx / d;
        ny = dy / d;
      } else {
        nx = 1;
      }
      p.x = o.x + nx * min;
      p.y = o.y + ny * min;
    } else {
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const ox = o.hw + radius - Math.abs(dx);
      const oy = o.hh + radius - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) {
        nx = Math.sign(dx) || 1;
        p.x += nx * ox;
      } else {
        ny = Math.sign(dy) || 1;
        p.y += ny * oy;
      }
    }

    if (!vel) continue;

    const into = vel.x * nx + vel.y * ny;
    if (into >= 0) continue;

    // Strip the into-surface component so momentum along the wall is preserved.
    vel.x -= into * nx;
    vel.y -= into * ny;

    // Corner assist: pushing square into a flat face leaves zero tangential velocity, so
    // the actor would sit against it indefinitely. Nudge them toward the nearer edge, at a
    // strength proportional to how hard they are pushing.
    if (into > -SLIP_MIN_PUSH) continue;
    const tx = -ny;
    const ty = nx;
    const along = vel.x * tx + vel.y * ty;
    if (Math.abs(along) >= SLIP_MAX) continue;
    const dir = Math.sign((p.x - o.x) * tx + (p.y - o.y) * ty) || 1;
    const target = dir * Math.min(SLIP_MAX, -into * 0.5);
    if (Math.abs(target) <= Math.abs(along) && Math.sign(target) === Math.sign(along)) continue;
    vel.x += (target - along) * tx;
    vel.y += (target - along) * ty;
  }
}

/**
 * True if a straight segment from a to b is blocked — used by runner bots to pick gaps.
 * Obstacles are the outer loop with an AABB reject up front, so the sampling inner loop
 * only runs for the handful of props actually near the segment.
 */
export function pathBlocked(map: GameMap, a: Vec2, b: Vec2, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(2, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 1.5));
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);

  for (const o of map.obstacles) {
    if (o.drag > 0) continue;
    const ohw = o.shape === 'circle' ? o.r : o.hw;
    const ohh = o.shape === 'circle' ? o.r : o.hh;
    const padX = ohw + radius;
    const padY = ohh + radius;
    if (o.x + padX < minX || o.x - padX > maxX) continue;
    if (o.y + padY < minY || o.y - padY > maxY) continue;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      if (o.shape === 'circle') {
        const ex = o.x - x;
        const ey = o.y - y;
        if (ex * ex + ey * ey < padX * padX) return true;
      } else if (Math.abs(x - o.x) < padX && Math.abs(y - o.y) < padY) {
        return true;
      }
    }
  }
  return false;
}
