import './style.css';
import { playClickSound } from './audio';

import { TICK } from './core/constants';
import { buildVillageMap } from './core/map';
import { createWorld, nextRound, playerActor, step, type MatchConfig } from './core/sim';
import type { World } from './core/types';
import { InputSource } from './input/input';
import { GameView } from './render/scene';
import type { Weather } from './render/village';
import { Hud } from './ui/hud';
import { RoundCard, setupMenu } from './ui/menu';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const gameMap = buildVillageMap();
const view = new GameView(el<HTMLCanvasElement>('gl'), gameMap, 'day');
const hud = new Hud(gameMap);
const roundCard = new RoundCard();

const touchRoot = el('touch');
const input = new InputSource(el('stick-base'), el('stick-knob'), touchRoot);
if (matchMedia('(pointer: coarse)').matches) {
  touchRoot.classList.remove('hidden');
  el('hints').classList.add('hidden');
}

let world: World | null = null;
let config: MatchConfig | null = null;
let lastRound = -1;
/** Sim time at which the end-of-round card should appear. */
let cardAt = Infinity;

const choice = setupMenu(
  (c) => {
    config = {
      playerTeam: 'blue',
      runnerRole: c.runnerRole,
      catcherRole: c.catcherRole,
    };
    startMatch();
  },
  (w: Weather) => view.setWeather(w),
);
view.setWeather(choice.weather);

function startMatch(): void {
  if (!config) return;
  world = createWorld(config);
  lastRound = -1;
  cardAt = Infinity;
  roundCard.hide();
  view.actors.reset();
  hud.resetFeed(world);
  input.setEnabled(true);
}

function onRoundBoundary(w: World): void {
  if (w.roundIndex === lastRound) return;
  lastRound = w.roundIndex;
  view.actors.reset();
  hud.resetFeed(w);
  cardAt = Infinity;
}

let accum = 0;
let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);

  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (!world) {
    menuWorld.t = now / 1000;
    view.update(menuWorld, dt, null);
    return;
  }

  onRoundBoundary(world);

  const paused = roundCard.visible;
  input.setEnabled(!paused);

  if (!paused) {
    accum += dt;
    let guard = 0;
    while (accum >= TICK && guard++ < 8) {
      accum -= TICK;
      step(world, gameMap, TICK, input.read());
    }
    if (guard >= 8) accum = 0;
  }

  const me = playerActor(world);
  hud.update(world, me);
  view.update(world, dt, me?.id ?? null);

  // Let the round settle for a beat before the summary card interrupts.
  if ((world.phase === 'roundover' || world.phase === 'matchover') && cardAt === Infinity) {
    cardAt = world.t + 2.2;
  }
  if (world.t >= cardAt && !roundCard.visible) {
    cardAt = Infinity;
    const finished = world.phase === 'matchover';
    roundCard.show(world, () => {
      if (!world || !config) return;
      if (finished) startMatch();
      else nextRound(world, config);
    });
  }
}

/** Placeholder world so the village renders behind the main menu. */
const menuWorld: World = (() => {
  return {
    t: 0,
    phase: 'lineup',
    phaseSince: 0,
    roundIndex: 0,
    roundClock: 0,
    lineupClock: 0,
    actors: [],
    walls: [],
    prints: [],
    pings: [],
    radarUntil: 0,
    sides: { blue: 'runner', red: 'catcher' },
    wins: { blue: 0, red: 0 },
    results: [],
    events: [],
    banner: '',
    subBanner: '',
    matchWinner: null,
  };
})();

// Drain buffered ability presses when the tab loses focus so they never fire on return.
addEventListener('visibilitychange', () => {
  if (document.hidden) input.read();
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button') || target.closest('.role')) {
    playClickSound();
  }
});

requestAnimationFrame(frame);

document.fonts.ready.then(() => {
  document.body.classList.remove('loading');
});
