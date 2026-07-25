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
export const LINEUP_TIME = 20;
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

export const SIGNAL_COOLDOWN = 6;
export const SIGNAL_DUR = 5;

/** Anti-camping: sampled window, movement threshold, and the penalty it applies. */
export const CAMP_WINDOW = 3.5;
export const CAMP_MIN_TRAVEL = 6.0;
export const CAMP_PENALTY_MAX = 0.42;
export const CAMP_PENALTY_RATE = 0.5;

export const TICK = 1 / 60;
