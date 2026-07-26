import { botInput } from './ai';
import {
  ACTOR_R,
  CAMP_MIN_SPAN,
  CAMP_PENALTY_MAX,
  CAMP_PENALTY_RATE,
  CAMP_SAMPLE,
  CAMP_SAMPLES,
  CHARGE_ON_NEAR_MISS,
  CHARGE_ON_TAG,
  CHARGE_RATE,
  FIELD,
  JUKE_AIM_ERROR,
  JUKE_COST,
  JUKE_DUR,
  JUKE_IMPULSE,
  LINEUP_TIME,
  MAX_ROUNDS,
  ROUNDS_TO_WIN,
  ROUND_TIME,
  SHIELD_IMMUNITY,
  SIGNAL_COOLDOWN,
  SIGNAL_DUR,
  SPRINT_DRAIN,
  SPRINT_MUL,
  SPRINT_RECOVER_FRAC,
  STAMINA_REGEN_DELAY,
  TOUCH_R,
  VAULT_COST,
  VAULT_DUR,
} from './constants';
import type { DifficultyId } from './difficulty';
import { resolveCollisions, terrainDrag, type GameMap } from './map';
import { CATCHER_ROLES, RUNNER_ROLES, role } from './roles';
import {
  clamp,
  clampToField,
  aiSpeed,
  clampToLane,
  catcherTeam,
  dist,
  isInvisible,
  isUltActive,
  laneY,
  runnerTeam,
  tagRadius,
} from './rules';
import type {
  Actor,
  GameEvent,
  PlayerInput,
  RoleId,
  RoundResult,
  Side,
  TeamId,
  World,
} from './types';

export interface MatchConfig {
  playerTeam: TeamId;
  runnerRole: RoleId;
  catcherRole: RoleId;
  difficulty: DifficultyId;
}

const BOT_NAMES = [
  'Rafiq', 'Shimul', 'Jorina', 'Babul', 'Nadia', 'Kamal', 'Milon',
  'Ripa', 'Sohel', 'Tuli', 'Jamal', 'Moni', 'Bulbul', 'Shanta',
];

function makeActor(
  id: number,
  team: TeamId,
  side: Side,
  roleId: RoleId,
  name: string,
  isPlayer: boolean,
  isCaptain: boolean,
  lane: number,
  x: number,
  y: number,
): Actor {
  return {
    id,
    team,
    side,
    role: roleId,
    name,
    isPlayer,
    isCaptain,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    facing: side === 'runner' ? Math.PI / 2 : -Math.PI / 2,
    state: side === 'runner' && !isCaptain ? 'held' : 'active',
    lane,
    stamina: role(roleId).staminaMax,
    charge: 20,
    ultUntil: 0,
    jukeUntil: 0,
    vaultUntil: 0,
    signalAt: 0,
    printAt: 0,
    lockUntil: 0,
    exhausted: false,
    immuneUntil: 0,
    campTrail: [],
    campSampleAt: 0,
    campPenalty: 0,
    camping: false,
    aimBias: 0,
    aiTargetX: x,
    aiRethinkAt: 0,
    resolvedAt: 0,
  };
}

function buildActors(w: World, cfg: MatchConfig): Actor[] {
  const out: Actor[] = [];
  let id = 1;
  let botName = 0;
  const nextName = () => BOT_NAMES[(botName++ + w.roundIndex * 3) % BOT_NAMES.length];

  const rTeam = runnerTeam(w);
  const cTeam = catcherTeam(w);
  const playerRuns = cfg.playerTeam === rTeam;

  // --- runner side: captain plus three team-mates spread across the base.
  // The spread is sized so the captain can realistically touch all three inside
  // LINEUP_TIME; widen it and the round always starts on the timer instead, which quietly
  // retires the touch mechanic.
  const runnerSpots: Array<[number, number]> = [
    [0, FIELD.spawnY - 4],
    [-4.5, FIELD.spawnY],
    [0, FIELD.spawnY],
    [4.5, FIELD.spawnY],
  ];
  const runnerRoles: RoleId[] = playerRuns
    ? [cfg.runnerRole, ...RUNNER_ROLES.filter((r) => r !== cfg.runnerRole)]
    : ['sprinter', 'trickster', 'scout', 'tank'];

  runnerSpots.forEach(([x, y], i) => {
    const isPlayer = playerRuns && i === 0;
    out.push(
      makeActor(
        id++,
        rTeam,
        'runner',
        runnerRoles[i],
        isPlayer ? 'You' : nextName(),
        isPlayer,
        i === 0,
        -1,
        x,
        y,
      ),
    );
  });

  // --- catcher side: one defender per line, the player takes the second line
  const playerLane = 1;
  for (let lane = 0; lane < FIELD.lines.length; lane++) {
    const isPlayer = !playerRuns && lane === playerLane;
    const roleId: RoleId = isPlayer
      ? cfg.catcherRole
      : CATCHER_ROLES[(lane + (playerRuns ? 0 : 1)) % CATCHER_ROLES.length];
    out.push(
      makeActor(
        id++,
        cTeam,
        'catcher',
        roleId,
        isPlayer ? 'You' : nextName(),
        isPlayer,
        false,
        lane,
        lane % 2 === 0 ? -5 : 5,
        FIELD.lines[lane],
      ),
    );
  }

  return out;
}

export function createWorld(cfg: MatchConfig): World {
  const w: World = {
    t: 0,
    phase: 'lineup',
    phaseSince: 0,
    roundIndex: 0,
    roundClock: ROUND_TIME,
    lineupClock: LINEUP_TIME,
    actors: [],
    walls: [],
    prints: [],
    pings: [],
    radarUntil: 0,
    playerTeam: cfg.playerTeam,
    difficulty: cfg.difficulty,
    sides: { blue: 'runner', red: 'catcher' },
    wins: { blue: 0, red: 0 },
    results: [],
    events: [],
    eventSeq: 0,
    banner: '',
    subBanner: '',
    matchWinner: null,
  };
  setupRound(w, cfg);
  return w;
}

export function setupRound(w: World, cfg: MatchConfig): void {
  w.playerTeam = cfg.playerTeam;
  w.difficulty = cfg.difficulty;
  const blueRuns = w.roundIndex % 2 === 0;
  w.sides = blueRuns
    ? { blue: 'runner', red: 'catcher' }
    : { blue: 'catcher', red: 'runner' };
  w.actors = buildActors(w, cfg);
  w.walls = [];
  w.prints = [];
  w.pings = [];
  w.radarUntil = 0;
  w.phase = 'lineup';
  w.phaseSince = w.t;
  w.roundClock = ROUND_TIME;
  w.lineupClock = LINEUP_TIME;
  w.banner = `Round ${w.roundIndex + 1}`;
  w.subBanner =
    cfg.playerTeam === runnerTeam(w)
      ? 'You run. Touch your team-mates to start.'
      : 'You defend. Hold your line.';
}

export function nextRound(w: World, cfg: MatchConfig): void {
  if (w.phase === 'matchover') return;
  w.roundIndex++;
  setupRound(w, cfg);
}

function push(w: World, ev: Omit<GameEvent, 'id'>): void {
  (ev as GameEvent).id = w.eventSeq++;
  w.events.push(ev as GameEvent);
  if (w.events.length > 40) w.events.shift();
}

// ---------------------------------------------------------------- per-actor

function activateUlt(w: World, a: Actor): void {
  const def = role(a.role);
  if (a.charge < def.ultCost || isUltActive(w, a)) return;
  a.charge -= def.ultCost;
  a.ultUntil = w.t + def.ultDur;

  switch (a.role) {
    case 'scout':
      w.radarUntil = Math.max(w.radarUntil, a.ultUntil);
      break;
    case 'guardian':
      w.walls.push({
        x: a.pos.x,
        y: laneY(a),
        halfLen: 4,
        until: a.ultUntil,
        owner: a.id,
      });
      break;
    case 'hunter': {
      const target = w.actors
        .filter((r) => r.side === 'runner' && r.state === 'active' && !isInvisible(w, r))
        .sort((p, q) => dist(p.pos, a.pos) - dist(q.pos, a.pos))[0];
      const dir = target ? Math.sign(target.pos.x - a.pos.x) || 1 : Math.sign(a.vel.x) || 1;
      a.vel.x = dir * 25;
      a.vel.y = target ? clamp(target.pos.y - a.pos.y, -6, 6) : 0;
      a.lockUntil = a.ultUntil + 0.3;
      break;
    }
    default:
      break;
  }
  push(w, { kind: 'ult', t: w.t, actor: a.id, text: `${a.name}: ${def.ultName}` });
}

function updateCamping(w: World, a: Actor, dt: number): void {
  if (a.side !== 'catcher' || w.phase !== 'live') {
    a.camping = false;
    a.campTrail.length = 0;
    a.campSampleAt = 0;
    a.campPenalty = Math.max(0, a.campPenalty - CAMP_PENALTY_RATE * dt);
    return;
  }

  // Samples are taken on a fixed clock and *always* recorded, standing still included.
  // Sampling only on movement meant a defender who froze completely stopped feeding the
  // trail, so the check never fired on the one behaviour it exists to punish.
  const trail = a.campTrail;
  if (w.t >= a.campSampleAt) {
    a.campSampleAt = w.t + CAMP_SAMPLE;
    trail.push({ x: a.pos.x, y: a.pos.y });
    if (trail.length > CAMP_SAMPLES) trail.shift();

    if (trail.length >= CAMP_SAMPLES) {
      // Width of the stretch of line covered, not distance walked — see CAMP_MIN_SPAN.
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of trail) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
      const wasCamping = a.camping;
      a.camping = hi - lo < CAMP_MIN_SPAN;
      if (a.camping && !wasCamping) {
        push(w, { kind: 'camp', t: w.t, actor: a.id, text: `${a.name} is camping — slowing down` });
      }
    }
  }

  a.campPenalty = a.camping
    ? Math.min(CAMP_PENALTY_MAX, a.campPenalty + CAMP_PENALTY_RATE * dt)
    : Math.max(0, a.campPenalty - CAMP_PENALTY_RATE * 1.6 * dt);
}

function stepActor(w: World, map: GameMap, a: Actor, inp: PlayerInput, dt: number): void {
  const def = role(a.role);
  const frozen =
    a.state === 'safe' ||
    a.state === 'caught' ||
    a.state === 'held' ||
    w.phase === 'roundover' ||
    w.phase === 'matchover' ||
    a.lockUntil > w.t;

  a.aimBias *= Math.exp(-1.4 * dt);
  updateCamping(w, a, dt);

  if (w.phase === 'live') a.charge = Math.min(100, a.charge + CHARGE_RATE * dt);

  if (frozen && !(a.role === 'hunter' && isUltActive(w, a))) {
    a.vel.x *= Math.exp(-6 * dt);
    a.vel.y *= Math.exp(-6 * dt);
  } else {
    // --- abilities
    if (inp.ult) activateUlt(w, a);

    if (inp.jump && a.vaultUntil < w.t && a.stamina >= VAULT_COST) {
      a.vaultUntil = w.t + VAULT_DUR;
      a.stamina -= VAULT_COST;
    }

    if (inp.juke && a.jukeUntil < w.t - 0.35 && a.stamina >= JUKE_COST) {
      a.jukeUntil = w.t + JUKE_DUR;
      a.stamina -= JUKE_COST;
      const lat = Math.abs(inp.move.x) > 0.15 ? Math.sign(inp.move.x) : Math.sign(a.vel.x) || 1;
      a.vel.x += lat * JUKE_IMPULSE;
      if (a.side === 'runner') {
        // The whole point of a fake move: defenders read the wrong line.
        for (const c of w.actors) {
          if (c.side !== 'catcher') continue;
          if (dist(c.pos, a.pos) > 14) continue;
          c.aimBias += -lat * JUKE_AIM_ERROR * (0.6 + Math.random() * 0.6);
        }
        w.prints.push({ x: a.pos.x + lat * 2.5, y: a.pos.y, until: w.t + 2.2, fake: true });
      }
    }

    if (inp.signal && a.signalAt < w.t) {
      a.signalAt = w.t + SIGNAL_COOLDOWN;
      w.pings.push({
        x: a.pos.x,
        y: a.pos.y + (a.side === 'runner' ? 8 : 0),
        until: w.t + SIGNAL_DUR,
        team: a.team,
      });
      push(w, { kind: 'signal', t: w.t, actor: a.id, text: `${a.name} signalled the team` });
    }

    // --- speed
    const moveLen = Math.sqrt(inp.move.x * inp.move.x + inp.move.y * inp.move.y);
    const freeSprint = a.role === 'sprinter' && isUltActive(w, a);

    // Hysteresis: once winded you stay winded until stamina climbs back over the
    // recovery threshold. A bare `stamina > 0` test flip-flops every tick at zero and
    // leaks a permanent partial sprint.
    if (a.stamina <= 0) a.exhausted = true;
    else if (a.stamina >= def.staminaMax * SPRINT_RECOVER_FRAC) a.exhausted = false;

    const wantsSprint = inp.sprint && moveLen > 0.15 && (!a.exhausted || freeSprint);

    if (wantsSprint && !freeSprint) {
      a.stamina = Math.max(0, a.stamina - SPRINT_DRAIN * dt);
    } else if (w.t - a.jukeUntil > STAMINA_REGEN_DELAY) {
      a.stamina = Math.min(def.staminaMax, a.stamina + def.staminaRegen * dt);
    }

    let speed = def.speed;
    if (wantsSprint) speed *= SPRINT_MUL;
    if (freeSprint) speed *= 1.45;
    if (a.vaultUntil > w.t) speed *= 1.08;
    speed *= terrainDrag(map, a.pos);
    speed *= 1 - a.campPenalty;
    speed *= aiSpeed(w, a); // 1.0 for the player and their team-mates

    const dashing = a.role === 'hunter' && isUltActive(w, a);
    if (!dashing) {
      const tx = moveLen > 1 ? inp.move.x / moveLen : inp.move.x;
      const ty = moveLen > 1 ? inp.move.y / moveLen : inp.move.y;
      const accel = a.jukeUntil > w.t ? 4 : 13;
      const k = 1 - Math.exp(-accel * dt);
      a.vel.x += (tx * speed - a.vel.x) * k;
      a.vel.y += (ty * speed - a.vel.y) * k;
    } else {
      a.vel.x *= Math.exp(-1.2 * dt);
      a.vel.y *= Math.exp(-3 * dt);
    }
  }

  // --- integrate
  a.pos.x += a.vel.x * dt;
  a.pos.y += a.vel.y * dt;

  // Passing `a.vel` lets the solver strip the into-surface component, so brushing a house
  // at an angle slides you along it instead of killing all momentum.
  resolveCollisions(map, a.pos, ACTOR_R, a.vaultUntil > w.t, a.vel);

  // Bamboo barriers only stop runners. `step()` already pruned expired walls.
  if (a.side === 'runner') {
    for (const wall of w.walls) {
      if (wall.until <= w.t) continue;
      const dx = a.pos.x - wall.x;
      const dy = a.pos.y - wall.y;
      const ox = wall.halfLen + ACTOR_R - Math.abs(dx);
      const oy = 0.7 + ACTOR_R - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        if (ox < oy) {
          const n = Math.sign(dx) || 1;
          a.pos.x += n * ox;
          if (a.vel.x * n < 0) a.vel.x = 0;
        } else {
          const n = Math.sign(dy) || 1;
          a.pos.y += n * oy;
          if (a.vel.y * n < 0) a.vel.y = 0;
        }
      }
    }
  }

  if (a.side === 'catcher') {
    clampToLane(a, ACTOR_R);
  } else {
    clampToField(a.pos, ACTOR_R);
    // Runners are pinned to the base until the round actually goes live.
    if (w.phase === 'lineup' && a.pos.y > FIELD.baseFront - 0.6) {
      a.pos.y = FIELD.baseFront - 0.6;
      a.vel.y = Math.min(a.vel.y, 0);
    }
    if (w.phase === 'live' && a.state === 'active' && w.t > a.printAt) {
      a.printAt = w.t + 0.34;
      w.prints.push({ x: a.pos.x, y: a.pos.y, until: w.t + 2.6, fake: false });
      if (a.role === 'trickster' && a.vel.x * a.vel.x + a.vel.y * a.vel.y > 4) {
        const lat = Math.sign(a.vel.x) || 1;
        w.prints.push({ x: a.pos.x - lat * 3.2, y: a.pos.y, until: w.t + 2.6, fake: true });
      }
    }
  }

  if (a.vel.x * a.vel.x + a.vel.y * a.vel.y > 0.16) a.facing = Math.atan2(a.vel.x, a.vel.y);
}

// ------------------------------------------------------------------ round

function resolveTouches(w: World): void {
  if (w.phase !== 'lineup') return;
  const captain = w.actors.find((a) => a.side === 'runner' && a.isCaptain);
  if (!captain) return;

  for (const r of w.actors) {
    if (r.side !== 'runner' || r.state !== 'held') continue;
    if (dist(r.pos, captain.pos) <= TOUCH_R) {
      r.state = 'active';
      push(w, { kind: 'released', t: w.t, actor: r.id, text: `${r.name} released` });
    }
  }

  const stillHeld = w.actors.some((a) => a.side === 'runner' && a.state === 'held');
  if (!stillHeld) goLive(w);
}

function goLive(w: World): void {
  if (w.phase !== 'lineup') return;
  for (const a of w.actors) if (a.side === 'runner' && a.state === 'held') a.state = 'active';
  w.phase = 'live';
  w.phaseSince = w.t;
  w.banner = 'GO!';
  w.subBanner = '';
  push(w, { kind: 'roundstart', t: w.t, text: 'Round live' });
}

function resolveTags(w: World, dt: number): void {
  if (w.phase !== 'live') return;

  // Runners are the outer loop so each one resolves at most once per tick. With catchers
  // outside, a Shield could be burned by the first defender and the now-bare runner tagged
  // by the next defender in the very same tick.
  for (const r of w.actors) {
    if (r.side !== 'runner' || r.state !== 'active') continue;

    if (r.pos.y >= FIELD.safeFront) {
      r.state = 'safe';
      r.resolvedAt = w.t;
      r.vel.x = 0;
      r.vel.y = 0;
      push(w, { kind: 'safe', t: w.t, actor: r.id, text: `${r.name} reached the safe zone` });
      continue;
    }

    const hidden = isInvisible(w, r);

    for (const c of w.actors) {
      if (c.side !== 'catcher') continue;
      const reach = tagRadius(w, c) + ACTOR_R;
      const d = dist(c.pos, r.pos);

      if (d < reach && !hidden && r.immuneUntil <= w.t) {
        if (r.role === 'tank' && isUltActive(w, r)) {
          // Shield eats the tag and shoves the defender off their spot.
          r.ultUntil = 0;
          r.immuneUntil = w.t + SHIELD_IMMUNITY;
          c.lockUntil = w.t + 0.85;
          const push2 = Math.sign(c.pos.x - r.pos.x) || 1;
          c.vel.x = push2 * 12;
          push(w, { kind: 'ult', t: w.t, actor: r.id, text: `${r.name} shrugged off ${c.name}` });
        } else {
          r.state = 'caught';
          r.resolvedAt = w.t;
          r.vel.x = 0;
          r.vel.y = 0;
          c.charge = Math.min(100, c.charge + CHARGE_ON_TAG);
          push(w, { kind: 'caught', t: w.t, actor: r.id, text: `${c.name} tagged ${r.name}` });
          break;
        }
      } else if (d < reach + 2.0 && !hidden) {
        const gain = CHARGE_ON_NEAR_MISS * dt;
        c.charge = Math.min(100, c.charge + gain);
        r.charge = Math.min(100, r.charge + gain);
      }
    }
  }
}

function endRound(w: World, reason: string): void {
  let safeCount = 0;
  let caughtCount = 0;
  let containedCount = 0;
  for (const a of w.actors) {
    if (a.side !== 'runner') continue;
    if (a.state === 'safe') safeCount++;
    else if (a.state === 'caught') caughtCount++;
    else containedCount++;
  }

  const rTeam = runnerTeam(w);
  const cTeam = catcherTeam(w);
  const runnerPoints = safeCount;
  const catcherPoints = caughtCount + containedCount;
  // A 2–2 split goes to the defence: the line held.
  const winner = runnerPoints > catcherPoints ? rTeam : cTeam;

  const result: RoundResult = {
    index: w.roundIndex,
    runnerTeam: rTeam,
    safeCount,
    caughtCount,
    containedCount,
    runnerPoints,
    catcherPoints,
    winner,
  };
  w.results.push(result);
  w.wins[winner]++;

  w.phase = 'roundover';
  w.phaseSince = w.t;
  w.banner = `${winner === 'blue' ? 'Blue' : 'Red'} take the round`;
  w.subBanner = `${reason} — ${safeCount} safe, ${caughtCount} tagged, ${containedCount} contained`;
  push(w, { kind: 'roundend', t: w.t, text: w.banner });

  if (w.wins[winner] >= ROUNDS_TO_WIN || w.roundIndex + 1 >= MAX_ROUNDS) {
    w.phase = 'matchover';
    // Level on rounds (only reachable if MAX_ROUNDS is even) goes to whoever took the last
    // one, rather than silently defaulting to red.
    w.matchWinner =
      w.wins.blue === w.wins.red ? winner : w.wins.blue > w.wins.red ? 'blue' : 'red';
    w.banner = `${w.matchWinner === 'blue' ? 'Blue' : 'Red'} win the match`;
    w.subBanner = `${w.wins.blue} – ${w.wins.red}`;
  }
}

/** Drops expired entries in place — the filter equivalent without a fresh array per tick. */
function prune<T extends { until: number }>(list: T[], t: number): void {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].until > t) list[n++] = list[i];
  }
  list.length = n;
}

export function step(w: World, map: GameMap, dt: number, playerInput: PlayerInput): void {
  w.t += dt;

  prune(w.walls, w.t);
  prune(w.prints, w.t);
  prune(w.pings, w.t);

  if (w.phase === 'lineup') {
    w.lineupClock -= dt;
    if (w.lineupClock <= 0) goLive(w);
  } else if (w.phase === 'live') {
    w.roundClock = Math.max(0, w.roundClock - dt);
  }

  for (const a of w.actors) {
    const inp = a.isPlayer ? playerInput : botInput(w, map, a);
    stepActor(w, map, a, inp, dt);
  }

  resolveTouches(w);
  resolveTags(w, dt);

  if (w.phase === 'live') {
    const stillRunning = w.actors.some((a) => a.side === 'runner' && a.state === 'active');
    if (!stillRunning) {
      const anySafe = w.actors.some((a) => a.side === 'runner' && a.state === 'safe');
      endRound(w, anySafe ? 'All runners resolved' : 'All runners tagged');
    } else if (w.roundClock <= 0) {
      endRound(w, 'Time up');
    }
  }
}

export function playerActor(w: World): Actor | undefined {
  return w.actors.find((a) => a.isPlayer);
}
