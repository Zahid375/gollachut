import { ACTOR_R, FIELD, LANE_LEAN } from './constants';
import { pathBlocked, type GameMap } from './map';
import { role } from './roles';
import {
  clamp,
  dist,
  isInvisible,
  isUltActive,
  laneY,
  nextLineY,
  wallAt,
} from './rules';
import { emptyInput, type Actor, type PlayerInput, type World } from './types';

const norm = (x: number, y: number): { x: number; y: number } => {
  const d = Math.hypot(x, y);
  return d < 1e-5 ? { x: 0, y: 0 } : { x: x / d, y: y / d };
};

export function botInput(w: World, map: GameMap, a: Actor): PlayerInput {
  if (a.state === 'safe' || a.state === 'caught') return emptyInput();
  if (a.lockUntil > w.t) return emptyInput();
  return a.side === 'catcher' ? catcherBrain(w, a) : runnerBrain(w, map, a);
}

// ---------------------------------------------------------------- catchers

interface Threat {
  r: Actor;
  predX: number;
  eta: number;
  cost: number;
}

function threatsFor(w: World, a: Actor): Threat[] {
  const ly = laneY(a);
  const out: Threat[] = [];
  for (const r of w.actors) {
    if (r.side !== 'runner' || r.state !== 'active') continue;
    if (isInvisible(w, r)) continue;
    if (r.pos.y > ly + 3.5) continue; // already through this line

    const vy = Math.max(r.vel.y, 0.4);
    const eta = clamp((ly - r.pos.y) / vy, 0, 8);
    let predX = r.pos.x + r.vel.x * Math.min(eta, 2.2) + a.aimBias;

    // Fake footprints drag the read off the true line.
    if (r.role === 'trickster') {
      const fake = w.prints.find((p) => p.fake && p.until > w.t && Math.abs(p.y - r.pos.y) < 6);
      if (fake) predX = predX * 0.55 + fake.x * 0.45;
    }

    const cost = Math.abs(ly - r.pos.y) * 0.55 + Math.abs(predX - a.pos.x) * 0.45;
    out.push({ r, predX, eta, cost });
  }
  return out.sort((p, q) => p.cost - q.cost);
}

function catcherBrain(w: World, a: Actor): PlayerInput {
  const inp = emptyInput();
  const ly = laneY(a);
  const def = role(a.role);
  const list = threatsFor(w, a);
  const primary = list[0];

  if (w.phase === 'lineup') {
    // Shuffle along the line while the captain does the touches — no camping penalty yet,
    // but it reads as "ready" instead of frozen.
    inp.move.x = Math.sin(w.t * 0.9 + a.id) * 0.5;
    return inp;
  }

  if (!primary) {
    // Nothing to answer: drift toward the middle of the pack and keep moving so the
    // anti-camping rule never bites.
    const runners = w.actors.filter((r) => r.side === 'runner' && r.state === 'active');
    const avgX = runners.length
      ? runners.reduce((s, r) => s + r.pos.x, 0) / runners.length
      : Math.sin(w.t * 0.5 + a.id * 2) * 12;
    const dx = avgX + Math.sin(w.t * 0.7 + a.id) * 7 - a.pos.x;
    inp.move.x = clamp(dx / 3, -1, 1);
    inp.move.y = clamp((ly - a.pos.y) / 2, -1, 1);
    return inp;
  }

  const dx = primary.predX - a.pos.x;
  inp.move.x = clamp(dx / 2.2, -1, 1);

  // Lean off the line only when the runner is genuinely at the doorstep.
  const close = Math.abs(dx) < 5 && Math.abs(primary.r.pos.y - ly) < LANE_LEAN + 4;
  const wantY = close ? clamp(primary.r.pos.y, ly - LANE_LEAN, ly + LANE_LEAN) : ly;
  inp.move.y = clamp((wantY - a.pos.y) / 1.5, -1, 1);

  inp.sprint = Math.abs(dx) > 3.5 && a.stamina > 18 && primary.eta < 3.5;

  if (a.camping) {
    // Bots obey the same rule the players do: break the camp before it costs speed.
    inp.move.x = Math.sign(Math.sin(w.t * 1.4 + a.id)) || 1;
    inp.sprint = a.stamina > 30;
  }

  const gap = dist(a.pos, primary.r.pos);
  if (a.charge >= def.ultCost) {
    if (a.role === 'hunter' && gap < 6.5 && gap > 1.4 && Math.abs(primary.r.pos.y - ly) < 5) {
      inp.ult = true;
    }
    if (a.role === 'guardian' && primary.eta < 2.6 && Math.abs(dx) < 10) {
      // Only worth it if the runner is not already lined up on top of us.
      if (Math.abs(dx) > 2.5 && !wallAt(w, primary.predX, ly, 0)) inp.ult = true;
    }
  }
  return inp;
}

// ----------------------------------------------------------------- runners

function crossingScore(
  w: World,
  map: GameMap,
  a: Actor,
  cand: number,
  ly: number,
  guards: Actor[],
): number {
  let s = 0;
  let nearest = 99;
  for (const g of guards) {
    const d = Math.abs(g.pos.x - cand);
    nearest = Math.min(nearest, d);
    if (isUltActive(w, g) && g.role === 'hunter') s -= Math.max(0, 9 - d) * 1.2;
  }
  s += Math.min(nearest, 16) * 1.6;
  s -= Math.abs(cand - a.pos.x) * 0.45;
  s -= Math.abs(cand) * 0.05; // mild pull to open ground, away from the touchlines

  if (wallAt(w, cand, ly, 1.2)) s -= 40;
  if (pathBlocked(map, a.pos, { x: cand, y: ly + 2 }, ACTOR_R + 0.3)) s -= 14;

  const ping = w.pings.find((p) => p.until > w.t && p.team === a.team);
  if (ping) s += Math.max(0, 10 - Math.abs(ping.x - cand)) * 0.9;

  return s;
}

function runnerBrain(w: World, map: GameMap, a: Actor): PlayerInput {
  const inp = emptyInput();
  const me = role(a.role);

  if (w.phase === 'lineup') {
    if (!a.isCaptain) return inp;
    // Captain's job: touch every held team-mate to start the round.
    const held = w.actors
      .filter((t) => t.side === 'runner' && t.state === 'held')
      .sort((p, q) => dist(a.pos, p.pos) - dist(a.pos, q.pos))[0];
    if (!held) return inp;
    const d = norm(held.pos.x - a.pos.x, held.pos.y - a.pos.y);
    inp.move.x = d.x;
    inp.move.y = d.y;
    inp.sprint = a.stamina > 40;
    return inp;
  }

  const ly = nextLineY(a.pos.y);

  if (ly === null) {
    // Clear of every line — straight for the safe zone.
    const d = norm(a.pos.x * -0.15, FIELD.safeFront + 4 - a.pos.y);
    inp.move.x = d.x;
    inp.move.y = d.y;
    inp.sprint = a.stamina > 12;
    if (a.charge >= me.ultCost && a.role === 'sprinter') inp.ult = true;
    return inp;
  }

  const guards = w.actors.filter(
    (g) => g.side === 'catcher' && Math.abs(laneY(g) - ly) < 0.5,
  );

  if (w.t > a.aiRethinkAt) {
    a.aiRethinkAt = w.t + 0.55 + Math.random() * 0.4;
    let best = a.pos.x;
    let bestScore = -Infinity;
    for (let x = -FIELD.halfW + 2.5; x <= FIELD.halfW - 2.5; x += 2.5) {
      const s = crossingScore(w, map, a, x, ly, guards);
      if (s > bestScore) {
        bestScore = s;
        best = x;
      }
    }
    a.aiTargetX = best;
  }

  const gapToLine = ly - a.pos.y;
  const guardGap = guards.length
    ? Math.min(...guards.map((g) => Math.abs(g.pos.x - a.aiTargetX)))
    : 99;

  // Stage a few metres short of the line, then commit when the lane is genuinely open.
  const stageY = ly - 7.5;
  const commit = guardGap > 7 || gapToLine < 3.5 || guards.every((g) => g.campPenalty > 0.25);

  const targetY = commit ? ly + 5 : Math.min(stageY, a.pos.y + 4);
  const d = norm(a.aiTargetX - a.pos.x, targetY - a.pos.y);
  inp.move.x = d.x;
  inp.move.y = d.y;
  inp.sprint = commit ? a.stamina > 10 : a.stamina > 55 && gapToLine > 14;

  // Immediate danger overrides the plan.
  const danger = guards
    .map((g) => ({ g, d: dist(g.pos, a.pos) }))
    .sort((p, q) => p.d - q.d)[0];

  if (danger && danger.d < 5.5) {
    const away = Math.sign(a.pos.x - danger.g.pos.x) || 1;
    inp.move.x = away * 0.85;
    inp.move.y = 0.55;
    inp.sprint = a.stamina > 8;
    if (danger.d < 3.4 && a.stamina > 30) inp.juke = true;
    if (a.charge >= me.ultCost && (a.role === 'trickster' || a.role === 'tank')) inp.ult = true;
  }

  if (a.charge >= me.ultCost) {
    if (a.role === 'sprinter' && commit && gapToLine < 12) inp.ult = true;
    if (a.role === 'scout' && gapToLine < 18) inp.ult = true;
  }

  // Hop the small props rather than running around them.
  if (a.stamina > 40 && Math.random() < 0.02 && commit) inp.jump = true;

  return inp;
}
