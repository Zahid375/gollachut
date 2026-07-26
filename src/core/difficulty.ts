// Difficulty tuning.
//
// Every knob here applies to the *opposing* bots only — never to the player, and never to
// the player's own team-mates, who always play at NEUTRAL. Picking Easy should make the
// other side beatable, not make your own side worse at their job. `aiTuning()` in rules.ts
// is the single place that decides which actors a setting applies to.
//
// The two sides are tuned independently. Weakening the defenders is what makes *attacking*
// easier; strengthening the opposing runners is what makes *defending* harder. A single
// shared "skill" number cannot express both, because each round swaps which one you face.

export type DifficultyId = 'easy' | 'medium' | 'hard';

export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  icon: string;
  blurb: string;

  // --- opposing defenders: these govern how hard it is to score
  /** Movement-speed multiplier. */
  catcherSpeed: number;
  /** Tag-reach multiplier. */
  catcherTagR: number;
  /** Fraction of the computed intercept they commit to, 0..1. */
  reaction: number;
  /** Smooth read error in metres. Hurts them — they aim at the wrong spot. */
  aimNoise: number;
  /**
   * Deliberate patrol oscillation in metres around the intercept. Helps them by covering a
   * band rather than a point. Kept separate from aimNoise because a large misread sweeps
   * ground as a side effect, which once made a sloppy defender out-perform a precise one.
   */
  sweep: number;

  // --- opposing runners: these govern how hard it is to keep them out
  /** Movement-speed multiplier. */
  runnerSpeed: number;
  /** Range at which they break off and evade. */
  reflex: number;

  /** Whether opposing bots spend their ultimates at all. */
  useUlts: boolean;
}

/** What the player's own team-mates always use, whatever difficulty is selected. */
export const NEUTRAL: DifficultyDef = {
  id: 'medium',
  name: 'Neutral',
  icon: '',
  blurb: '',
  catcherSpeed: 1,
  catcherTagR: 1,
  reaction: 1,
  aimNoise: 1,
  sweep: 1,
  runnerSpeed: 1,
  reflex: 5.5,
  useUlts: true,
};

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: 'easy',
    name: 'Easy',
    icon: '🌾',
    blurb: 'Defenders misread the line, hold back, and never spend their ultimates.',
    catcherSpeed: 0.72,
    catcherTagR: 0.62,
    reaction: 0.4,
    aimNoise: 5.5,
    sweep: 0.1,
    runnerSpeed: 0.9,
    reflex: 3.2,
    useUlts: false,
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    icon: '🥭',
    blurb: 'A fair village match. Defenders track you, but still bite on a good fake.',
    catcherSpeed: 0.78,
    catcherTagR: 0.7,
    reaction: 0.48,
    aimNoise: 4.6,
    sweep: 0.2,
    runnerSpeed: 1.02,
    reflex: 5,
    useUlts: true,
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    icon: '🔥',
    blurb: 'Longer reach, cleaner reads, and runners who break early. Use fakes and the pond.',
    catcherSpeed: 0.86,
    catcherTagR: 0.8,
    reaction: 0.62,
    aimNoise: 3.4,
    sweep: 0.5,
    runnerSpeed: 1.12,
    reflex: 6.5,
    useUlts: true,
  },
};

export const DIFFICULTY_IDS: DifficultyId[] = ['easy', 'medium', 'hard'];

export function difficulty(id: DifficultyId): DifficultyDef {
  return DIFFICULTIES[id];
}
