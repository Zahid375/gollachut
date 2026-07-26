// Pure data model for the Gollachut simulation.
// Nothing in core/ may import three.js or touch the DOM — this layer is meant to be
// lifted onto an authoritative Node server unchanged once netcode lands.

import type { DifficultyId } from './difficulty';

export type TeamId = 'blue' | 'red';
export type Side = 'runner' | 'catcher';
export type RoleId = 'sprinter' | 'tank' | 'trickster' | 'scout' | 'guardian' | 'hunter';

/** held = waiting for the captain's touch, active = running, then resolved. */
export type ActorState = 'held' | 'active' | 'safe' | 'caught';
export type Phase = 'lineup' | 'live' | 'roundover' | 'matchover';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Actor {
  id: number;
  team: TeamId;
  side: Side;
  role: RoleId;
  name: string;
  isPlayer: boolean;
  isCaptain: boolean;

  pos: Vec2;
  vel: Vec2;
  facing: number;
  state: ActorState;

  /** Catchers only: index into FIELD.lines — the line this defender owns. */
  lane: number;

  stamina: number;
  /** Ultimate charge, 0..100. */
  charge: number;
  ultUntil: number;
  jukeUntil: number;
  vaultUntil: number;
  /** Sim time the team signal comes off cooldown. */
  signalAt: number;
  /** Runners: sim time the next footprint is dropped. */
  printAt: number;
  /** Sim time until which this actor cannot act (post-dash recovery, tag stun). */
  lockUntil: number;

  /** True while stamina is spent; blocks sprinting until it has recovered enough. */
  exhausted: boolean;
  /** Sim time until which tags cannot land (granted when a Shield pops). */
  immuneUntil: number;

  /** Anti-camping bookkeeping: recent positions plus the current speed penalty. */
  campTrail: Vec2[];
  /** Sim time the next camp-trail sample is due. Samples are fixed-rate, not per-frame. */
  campSampleAt: number;
  campPenalty: number;
  camping: boolean;

  /** AI aim error injected by fake-moves; decays over time. */
  aimBias: number;
  aiTargetX: number;
  aiRethinkAt: number;
  resolvedAt: number;
}

export interface Wall {
  x: number;
  y: number;
  halfLen: number;
  until: number;
  owner: number;
}

export interface Footprint {
  x: number;
  y: number;
  until: number;
  fake: boolean;
}

export interface Ping {
  x: number;
  y: number;
  until: number;
  team: TeamId;
}

export type EventKind =
  | 'released'
  | 'safe'
  | 'caught'
  | 'ult'
  | 'signal'
  | 'camp'
  | 'roundstart'
  | 'roundend';

export interface GameEvent {
  /** Monotonic id. The events array is capped, so consumers must track this, not the index. */
  id: number;
  kind: EventKind;
  t: number;
  actor?: number;
  text: string;
}

export interface RoundResult {
  index: number;
  runnerTeam: TeamId;
  safeCount: number;
  caughtCount: number;
  containedCount: number;
  runnerPoints: number;
  catcherPoints: number;
  winner: TeamId;
}

export interface World {
  t: number;
  phase: Phase;
  phaseSince: number;
  roundIndex: number;
  roundClock: number;
  lineupClock: number;

  actors: Actor[];
  walls: Wall[];
  prints: Footprint[];
  pings: Ping[];
  radarUntil: number;

  /** The team the human is on. Used to decide which bots difficulty applies to. */
  playerTeam: TeamId;
  difficulty: DifficultyId;

  /** Which side each team is playing this round; swaps every round. */
  sides: Record<TeamId, Side>;
  /** Rounds won. */
  wins: Record<TeamId, number>;
  results: RoundResult[];
  events: GameEvent[];
  /** Id handed to the next event. Never resets, so the HUD feed cannot desync. */
  eventSeq: number;

  banner: string;
  subBanner: string;
  matchWinner: TeamId | null;
}

export interface PlayerInput {
  move: Vec2;
  sprint: boolean;
  jump: boolean;
  juke: boolean;
  signal: boolean;
  ult: boolean;
}

export function emptyInput(): PlayerInput {
  return {
    move: { x: 0, y: 0 },
    sprint: false,
    jump: false,
    juke: false,
    signal: false,
    ult: false,
  };
}
