import { ACTOR_R, FIELD, LANE_LEAN } from './constants';
import { pathBlocked, type GameMap } from './map';
import { role } from './roles';
import {
  aiTuning,
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
  const d = Math.sqrt(x * x + y * y);
  return d < 1e-5 ? { x: 0, y: 0 } : { x: x / d, y: y / d };
};

/**
 * One reusable input per call site. The sim consumes a bot's input inside the same
 * `stepActor` call and never retains it, so handing back a scratch object avoids
 * allocating a fresh PlayerInput (plus its nested `move`) for every bot every tick.
 */
const scratch = emptyInput();

function blank(): PlayerInput {
  scratch.move.x = 0;
  scratch.move.y = 0;
  scratch.sprint = false;
  scratch.jump = false;
  scratch.juke = false;
  scratch.signal = false;
  scratch.ult = false;
  return scratch;
}

export function botInput(w: World, map: GameMap, a: Actor): PlayerInput {
  if (a.state === 'safe' || a.state === 'caught') return blank();
  if (a.lockUntil > w.t) return blank();
  return a.side === 'catcher' ? catcherBrain(w, a) : runnerBrain(w, map, a);
}

// ---------------------------------------------------------------- catchers

interface Threat {
  r: Actor;
  predX: number;
  eta: number;
  cost: number;
}

/** Reused across ticks — `r` is only meaningful once `primaryThreat` returns non-null. */
const threat = { r: null, predX: 0, eta: 0, cost: 0 } as unknown as Threat;

/** Cheapest threat on this defender's line. Single pass, no array and no sort. */
function primaryThreat(w: World, a: Actor): Threat | null {
  const ly = laneY(a);
  let best = Infinity;
  let found = false;

  for (const r of w.actors) {
    if (r.side !== 'runner' || r.state !== 'active') continue;
    if (isInvisible(w, r)) continue;
    if (r.pos.y > ly + 3.5) continue; // already through this line

    const vy = Math.max(r.vel.y, 0.4);
    const eta = clamp((ly - r.pos.y) / vy, 0, 8);
    let predX = r.pos.x + r.vel.x * Math.min(eta, 2.2) + a.aimBias;

    // Fake footprints drag the read off the true line.
    if (r.role === 'trickster') {
      for (const p of w.prints) {
        if (p.fake && p.until > w.t && Math.abs(p.y - r.pos.y) < 6) {
          predX = predX * 0.55 + p.x * 0.45;
          break;
        }
      }
    }

    const cost = Math.abs(ly - r.pos.y) * 0.55 + Math.abs(predX - a.pos.x) * 0.45;
    if (cost < best) {
      best = cost;
      found = true;
      threat.r = r;
      threat.predX = predX;
      threat.eta = eta;
      threat.cost = cost;
    }
  }
  return found ? threat : null;
}

function catcherBrain(w: World, a: Actor): PlayerInput {
  const inp = blank();
  const ly = laneY(a);
  const def = role(a.role);
  const tune = aiTuning(w, a);
  const primary = primaryThreat(w, a);

  if (w.phase === 'lineup') {
    // Shuffle along the line while the captain does the touches — no camping penalty yet,
    // but it reads as "ready" instead of frozen.
    inp.move.x = Math.sin(w.t * 0.9 + a.id) * 0.5;
    return inp;
  }

  if (!primary) {
    // Nothing to answer: drift toward the middle of the pack and keep moving so the
    // anti-camping rule never bites.
    let sumX = 0;
    let n = 0;
    for (const r of w.actors) {
      if (r.side === 'runner' && r.state === 'active') {
        sumX += r.pos.x;
        n++;
      }
    }
    const avgX = n ? sumX / n : Math.sin(w.t * 0.5 + a.id * 2) * 12;
    const dx = avgX + Math.sin(w.t * 0.7 + a.id) * 7 - a.pos.x;
    inp.move.x = clamp(dx / 3, -1, 1);
    inp.move.y = clamp((ly - a.pos.y) / 2, -1, 1);
    return inp;
  }

  // Two separate offsets, on deliberately different periods so they never lock in phase:
  // `misread` is error (Easy aims at the wrong place), `sweep` is deliberate coverage
  // (Hard patrols a band around the intercept rather than standing on one point).
  const misread = tune.aimNoise ? Math.sin(w.t * 0.9 + a.id * 2.3) * tune.aimNoise : 0;
  const sweep = tune.sweep ? Math.sin(w.t * 1.7 + a.id * 1.3) * tune.sweep : 0;
  const dx = primary.predX + misread + sweep - a.pos.x;
  inp.move.x = clamp(dx / 2.2, -1, 1) * tune.reaction;

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
  if (tune.useUlts && a.charge >= def.ultCost) {
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
  probe.x = cand;
  probe.y = ly + 2;
  if (pathBlocked(map, a.pos, probe, ACTOR_R + 0.3)) s -= 14;

  for (const p of w.pings) {
    if (p.until > w.t && p.team === a.team) {
      s += Math.max(0, 10 - Math.abs(p.x - cand)) * 0.9;
      break;
    }
  }

  return s;
}

/** Scratch objects for the per-rethink candidate sweep. */
const probe = { x: 0, y: 0 };
const guardScratch: Actor[] = [];

function runnerBrain(w: World, map: GameMap, a: Actor): PlayerInput {
  const inp = blank();
  const me = role(a.role);
  const tune = aiTuning(w, a);

  if (w.phase === 'lineup') {
    if (!a.isCaptain) return inp;
    // Captain's job: touch every held team-mate to start the round.
    let held: Actor | null = null;
    let heldD = Infinity;
    for (const t of w.actors) {
      if (t.side !== 'runner' || t.state !== 'held') continue;
      const d = dist(a.pos, t.pos);
      if (d < heldD) {
        heldD = d;
        held = t;
      }
    }
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
    if (tune.useUlts && a.charge >= me.ultCost && a.role === 'sprinter') inp.ult = true;
    return inp;
  }

  const guards = guardScratch;
  guards.length = 0;
  for (const g of w.actors) {
    if (g.side === 'catcher' && Math.abs(laneY(g) - ly) < 0.5) guards.push(g);
  }

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
  let guardGap = 99;
  let allCamping = true;
  for (const g of guards) {
    guardGap = Math.min(guardGap, Math.abs(g.pos.x - a.aiTargetX));
    if (g.campPenalty <= 0.25) allCamping = false;
  }

  // Stage a few metres short of the line, then commit when the lane is genuinely open.
  const stageY = ly - 7.5;
  const commit = guardGap > 7 || gapToLine < 3.5 || allCamping;

  const targetY = commit ? ly + 5 : Math.min(stageY, a.pos.y + 4);
  const d = norm(a.aiTargetX - a.pos.x, targetY - a.pos.y);
  inp.move.x = d.x;
  inp.move.y = d.y;
  inp.sprint = commit ? a.stamina > 10 : a.stamina > 55 && gapToLine > 14;

  // Immediate danger overrides the plan.
  let nearest: Actor | null = null;
  let nearestD = Infinity;
  for (const g of guards) {
    const d = dist(g.pos, a.pos);
    if (d < nearestD) {
      nearestD = d;
      nearest = g;
    }
  }

  if (nearest && nearestD < tune.reflex) {
    const away = Math.sign(a.pos.x - nearest.pos.x) || 1;
    inp.move.x = away * 0.85;
    inp.move.y = 0.55;
    inp.sprint = a.stamina > 8;
    if (nearestD < tune.reflex * 0.62 && a.stamina > 30) inp.juke = true;
    if (tune.useUlts && a.charge >= me.ultCost && (a.role === 'trickster' || a.role === 'tank')) {
      inp.ult = true;
    }
  }

  if (tune.useUlts && a.charge >= me.ultCost) {
    if (a.role === 'sprinter' && commit && gapToLine < 12) inp.ult = true;
    if (a.role === 'scout' && gapToLine < 18) inp.ult = true;
  }

  // Hop the small props rather than running around them.
  if (a.stamina > 40 && Math.random() < 0.02 && commit) inp.jump = true;

  return inp;
}
