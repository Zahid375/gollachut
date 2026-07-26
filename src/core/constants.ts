// Field geometry follows the layout in the design doc:
//
//        Safe Zone            y = 80 .. 93
//   ---------------------     line 3   y = 64
//   ---------------------     line 2   y = 48
//   ---------------------     line 1   y = 32
//   ---------------------     line 0   y = 16
//    Runners + Captain        y = -6
//         Base                y = -15 .. 0
//
// Each catcher owns one line and patrols along it — the traditional Gollachut rule.
// Runners start at the base and must cross all four lines to reach the safe zone.

export const FIELD = {
  halfW: 26,
  baseFront: 0,
  baseBack: -15,
  spawnY: -6,
  lines: [16, 32, 48, 64],
  safeFront: 80,
  safeBack: 93,
};

export const ROUND_TIME = 75;
export const LINEUP_TIME = 5;
export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 3;

export const ACTOR_R = 0.55;
/** Captain must get this close to a held teammate to release them. */
export const TOUCH_R = 2.2;
/** How far off their line a catcher may lean. */
export const LANE_LEAN = 2.6;

export const SPRINT_MUL = 1.5;
export const SPRINT_DRAIN = 24;
export const STAMINA_REGEN_DELAY = 0.55;
/**
 * Once stamina hits zero the actor is winded and cannot sprint until stamina is back
 * above this fraction of their max. Without the hysteresis, drain and regen alternate
 * every tick at zero and you keep roughly a third of the sprint bonus for free.
 */
export const SPRINT_RECOVER_FRAC = 0.25;

export const CHARGE_RATE = 4.2;
export const CHARGE_ON_NEAR_MISS = 14;
export const CHARGE_ON_TAG = 30;

export const JUKE_DUR = 0.28;
export const JUKE_COST = 22;
export const JUKE_IMPULSE = 11;
export const JUKE_AIM_ERROR = 4.5;

export const VAULT_DUR = 0.45;
export const VAULT_COST = 16;
/** Obstacles at or below this radius can be vaulted. */
export const VAULT_MAX_R = 1.3;

/**
 * Corner assist. Running square into the flat face of a bamboo house leaves no sideways
 * velocity at all, so the actor stalls against it and reads as frozen. When someone is
 * pushing hard into a surface with no tangential motion, nudge them toward the nearer edge
 * so they glance off it instead. Only fires while actively pushing, so standing next to a
 * wall never makes you drift.
 */
export const SLIP_MIN_PUSH = 1.0;
export const SLIP_MAX = 3.0;

export const SIGNAL_COOLDOWN = 6;
export const SIGNAL_DUR = 5;

/**
 * Anti-camping: sampled window, the ground a defender must cover, and the penalty.
 *
 * The threshold is a *span* — how wide a stretch of the line you patrolled — not the total
 * path length you walked. Path length rewarded jittering on the spot (a defender wiggling
 * inside a one-metre box racked up plenty of "travel") while punishing the honest pattern
 * of standing to read the runner and then sprinting to intercept. Span measures the thing
 * the rule actually cares about: are you covering your line, or squatting on one spot?
 */
export const CAMP_WINDOW = 4.0;
export const CAMP_MIN_SPAN = 5.0;
export const CAMP_PENALTY_MAX = 0.28;
export const CAMP_PENALTY_RATE = 0.5;
/** Seconds between camp-trail samples. Fixed rate, so the window is always CAMP_WINDOW. */
export const CAMP_SAMPLE = 0.1;
export const CAMP_SAMPLES = Math.round(CAMP_WINDOW / CAMP_SAMPLE);

/** Grace period after a Shield absorbs a tag, so a second defender cannot re-tag instantly. */
export const SHIELD_IMMUNITY = 0.6;

export const TICK = 1 / 60;
