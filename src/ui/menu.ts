import { CATCHER_ROLES, RUNNER_ROLES, role } from '../core/roles';
import type { RoleId, World } from '../core/types';
import type { Weather } from '../render/village';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export interface MenuChoice {
  runnerRole: RoleId;
  catcherRole: RoleId;
  weather: Weather;
}

const WEATHER_LABEL: Record<Weather, string> = {
  day: '☀️ Day',
  sunset: '🌇 Sunset',
  rain: '🌧️ Rain',
};

const ROLE_ICONS: Record<string, string> = {
  sprinter: '⚡',
  tank: '🛡️',
  trickster: '🦊',
  scout: '👁️',
  guardian: '🧱',
  hunter: '🦅',
};

function fillRoles(host: HTMLElement, ids: RoleId[], selected: RoleId): void {
  host.innerHTML = ids
    .map((id) => {
      const r = role(id);
      const icon = ROLE_ICONS[id as string] || '👤';
      return `<button class="role${id === selected ? ' on' : ''}" data-role="${id}" data-desc="${r.blurb}" data-ultname="${r.ultName}" data-ultdesc="${r.ultBlurb}">
        <div class="role-icon">${icon}</div>
        <b>${r.name}</b>
      </button>`;
    })
    .join('');
}

export function setupMenu(
  onStart: (c: MenuChoice) => void,
  onWeather: (w: Weather) => void,
): MenuChoice {
  const choice: MenuChoice = { runnerRole: 'sprinter', catcherRole: 'hunter', weather: 'day' };

  const runnerHost = $('pick-runner');
  const catcherHost = $('pick-catcher');
  const weatherHost = $('pick-weather');
  const weatherBtn = $<HTMLButtonElement>('weather');

  fillRoles(runnerHost, RUNNER_ROLES, choice.runnerRole);
  fillRoles(catcherHost, CATCHER_ROLES, choice.catcherRole);

  const tooltip = $('game-tooltip');
  
  const handleTooltip = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-role]');
    if (btn && btn.dataset.desc) {
      tooltip.innerHTML = `
        <div class="tt-desc">${btn.dataset.desc}</div>
        <div class="tt-ult">
          <b>${btn.dataset.ultname}</b>
          <span>${btn.dataset.ultdesc}</span>
        </div>
      `;
      tooltip.classList.remove('hidden');
      
      const rect = btn.getBoundingClientRect();
      const ttRect = tooltip.getBoundingClientRect();
      let top = rect.top - ttRect.height - 15;
      let left = rect.left + (rect.width / 2) - (ttRect.width / 2);
      
      if (top < 10) top = rect.bottom + 15;
      if (left < 10) left = 10;
      if (left + ttRect.width > window.innerWidth - 10) left = window.innerWidth - ttRect.width - 10;
      
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    }
  };

  const hideTooltip = (e: MouseEvent) => {
    const toElement = e.relatedTarget as HTMLElement;
    if (!toElement || !toElement.closest('[data-role]')) {
      tooltip.classList.add('hidden');
    }
  };

  runnerHost.addEventListener('mouseover', handleTooltip);
  catcherHost.addEventListener('mouseover', handleTooltip);
  runnerHost.addEventListener('mouseout', hideTooltip);
  catcherHost.addEventListener('mouseout', hideTooltip);

  const wire = (host: HTMLElement, set: (id: RoleId) => void) => {
    host.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-role]');
      if (!btn) return;
      Array.from(host.querySelectorAll('.role')).forEach((el) => el.classList.remove('on'));
      btn.classList.add('on');
      set(btn.dataset.role as RoleId);
    });
  };
  wire(runnerHost, (id) => (choice.runnerRole = id));
  wire(catcherHost, (id) => (choice.catcherRole = id));

  const tabsContainer = document.querySelector('.role-tabs');
  const pickersContainer = $('role-pickers-container');
  if (tabsContainer && pickersContainer) {
    tabsContainer.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.tab-btn');
      if (btn) {
        tabsContainer.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        pickersContainer.className = `pickers show-${btn.dataset.target}`;
      }
    });
  }

  const nextBtn = document.getElementById('mobile-next-btn');
  const panel = document.querySelector('.game-menu-panel');
  if (nextBtn && panel) {
    nextBtn.addEventListener('click', () => {
      panel.classList.add('step-2');
    });
  }

  const applyWeather = (w: Weather) => {
    choice.weather = w;
    weatherBtn.textContent = WEATHER_LABEL[w];
    Array.from(weatherHost.querySelectorAll<HTMLElement>('[data-weather]')).forEach((el) =>
      el.classList.toggle('on', el.dataset.weather === w),
    );
    onWeather(w);
  };

  weatherHost.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-weather]');
    if (btn) applyWeather(btn.dataset.weather as Weather);
  });

  const order: Weather[] = ['day', 'sunset', 'rain'];
  weatherBtn.addEventListener('click', () => {
    applyWeather(order[(order.indexOf(choice.weather) + 1) % order.length]);
  });

  applyWeather('day');

  $('play').addEventListener('click', () => {
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    onStart(choice);
  });

  return choice;
}

export class RoundCard {
  private root = $('roundcard');
  private title = $('rc-title');
  private sub = $('rc-sub');
  private tally = $('rc-tally');
  private next = $<HTMLButtonElement>('rc-next');
  private handler: (() => void) | null = null;

  constructor() {
    this.next.addEventListener('click', () => {
      this.hide();
      this.handler?.();
    });
  }

  show(w: World, onNext: () => void): void {
    const r = w.results[w.results.length - 1];
    if (!r) return;
    this.handler = onNext;

    const over = w.phase === 'matchover';
    this.title.textContent = over
      ? `${w.matchWinner === 'blue' ? 'Blue' : 'Red'} win the match`
      : `${r.winner === 'blue' ? 'Blue' : 'Red'} take round ${r.index + 1}`;

    this.sub.textContent = over
      ? `Final score ${w.wins.blue} – ${w.wins.red}`
      : `${r.runnerTeam === 'blue' ? 'Blue' : 'Red'} were running. Sides swap next round.`;

    this.tally.innerHTML = `
      <div class="row"><span>Reached the safe zone</span><b>${r.safeCount}</b></div>
      <div class="row"><span>Tagged</span><b>${r.caughtCount}</b></div>
      <div class="row"><span>Still stranded at the whistle</span><b>${r.containedCount}</b></div>
      <div class="row"><span>Round points — attack vs defence</span><b>${r.runnerPoints} – ${r.catcherPoints}</b></div>`;

    this.next.textContent = over ? 'Play again' : 'Next round';
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
