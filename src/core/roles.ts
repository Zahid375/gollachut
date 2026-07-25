import type { RoleId, Side } from './types';

export interface RoleDef {
  id: RoleId;
  name: string;
  side: Side;
  blurb: string;
  /** Base metres/second. */
  speed: number;
  staminaMax: number;
  staminaRegen: number;
  /** Multiplier applied to incoming knockback / shove. */
  stability: number;
  tagR: number;
  ultName: string;
  ultDur: number;
  ultCost: number;
  ultBlurb: string;
  /** Kurta colour used by the renderer. */
  tint: number;
}

export const ROLES: Record<RoleId, RoleDef> = {
  sprinter: {
    id: 'sprinter',
    name: 'Sprinter',
    side: 'runner',
    blurb: 'Fastest legs in the village, but the wind runs out early.',
    speed: 7.4,
    staminaMax: 62,
    staminaRegen: 9,
    stability: 0.7,
    tagR: 0,
    ultName: 'Burst Sprint',
    ultDur: 5,
    ultCost: 100,
    ultBlurb: '+45% speed for 5s and stamina stops draining.',
    tint: 0x2e7dd6,
  },
  tank: {
    id: 'tank',
    name: 'Tank',
    side: 'runner',
    blurb: 'Slow and heavy. Shoves through a line instead of going around it.',
    speed: 5.7,
    staminaMax: 120,
    staminaRegen: 14,
    stability: 0,
    tagR: 0,
    ultName: 'Shield',
    ultDur: 6,
    ultCost: 100,
    ultBlurb: 'Survives the first tag within 6s and shrugs off the tagger.',
    tint: 0x1f5aa8,
  },
  trickster: {
    id: 'trickster',
    name: 'Trickster',
    side: 'runner',
    blurb: 'Leaves fake footprints that pull defenders the wrong way.',
    speed: 6.7,
    staminaMax: 90,
    staminaRegen: 12,
    stability: 0.6,
    tagR: 0,
    ultName: 'Vanish',
    ultDur: 3,
    ultCost: 100,
    ultBlurb: 'Invisible to defenders for 3s.',
    tint: 0x4a9be8,
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    side: 'runner',
    blurb: 'Always knows where the lines are thin.',
    speed: 6.9,
    staminaMax: 96,
    staminaRegen: 13,
    stability: 0.6,
    tagR: 0,
    ultName: 'Radar Scan',
    ultDur: 6,
    ultCost: 100,
    ultBlurb: 'Reveals every defender and their lean for 6s, team-wide.',
    tint: 0x63b3f0,
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    side: 'catcher',
    blurb: 'Holds a line and closes the gaps others leave open.',
    speed: 6.5,
    staminaMax: 105,
    staminaRegen: 13,
    stability: 0.3,
    tagR: 1.5,
    ultName: 'Wall Barrier',
    ultDur: 8,
    ultCost: 100,
    ultBlurb: 'Drops an 8m bamboo barrier on the line for 8s.',
    tint: 0xd6432e,
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    side: 'catcher',
    blurb: 'Longer reach and a lunge that closes gaps in a blink.',
    speed: 7.0,
    staminaMax: 84,
    staminaRegen: 11,
    stability: 0.6,
    tagR: 2.05,
    ultName: 'Dash Catch',
    ultDur: 0.85,
    ultCost: 65,
    ultBlurb: 'Explosive lunge along the line with an extended tag reach.',
    tint: 0xa8281f,
  },
};

export const RUNNER_ROLES: RoleId[] = ['sprinter', 'tank', 'trickster', 'scout'];
export const CATCHER_ROLES: RoleId[] = ['guardian', 'hunter'];

export function role(id: RoleId): RoleDef {
  return ROLES[id];
}
