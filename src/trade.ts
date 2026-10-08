// The late-game production line: the Fishing Wharf's boats bring in fish, the Cannery turns them
// into cans, and trade ships at the Export Docks buy the cans. None of it touches your own barrels.

import { BUILDING_BY_ID, FISH, FLEET, TRADE } from './config';
import { perkBonus } from './perks';
import { projectDone } from './projects';
import { workerCounts } from './population';
import { queueToast } from './quests';
import { state, type PlacedBuilding } from './state';
import { isWorking, wateredTiles } from './water';

/** A ship that just called, for the town to animate. */
export interface ShipVisit {
  cans: number;
  coins: number;
}

let visits: ShipVisit[] = [];

export function takeShipVisits(): ShipVisit[] {
  const out = visits;
  visits = [];
  return out;
}

function staffed(type: 'cannery' | 'exportDocks' | 'fishingWharf'): { b: PlacedBuilding; workers: number } | undefined {
  const b = state.buildings.find((x) => x.type === type);
  if (!b || !isWorking(b, wateredTiles())) return undefined;
  const workers = workerCounts().get(b.id) ?? 0;
  return workers > 0 ? { b, workers } : undefined;
}

/** Cans per minute the Cannery can make right now (if the hold has fish). */
export function canningRate(): number {
  const c = staffed('cannery');
  return c ? c.workers * (BUILDING_BY_ID.cannery.cansPerWorker?.(c.b.level) ?? 0) : 0;
}

/** Cans one trade ship can take right now (0 = no ships come). */
export function shipCapacity(): number {
  const d = staffed('exportDocks');
  return d ? d.workers * (BUILDING_BY_ID.exportDocks.shipCansPerWorker?.(d.b.level) ?? 0) : 0;
}

export const shipInterval = (): number => TRADE.shipEverySeconds / (1 + perkBonus('busyDocks'));
export const secondsToShip = (): number => Math.max(0, shipInterval() - state.shipTimer);

// ------------------------------------------------------------------- Fleet

/** A boat that just came home, for the town to animate. */
export interface BoatReturn {
  boat: number;
  fish: number;
}

let returns: BoatReturn[] = [];

export function takeBoatReturns(): BoatReturn[] {
  const out = returns;
  returns = [];
  return out;
}

export const tripSeconds = (): number => FLEET.tripMinutes * 60;

/** The wharf and how many boats are crewed (every 2 fishermen take one out). */
export function fleet(): { b: PlacedBuilding; boats: number } | undefined {
  const w = staffed('fishingWharf');
  if (!w) return undefined;
  const boats = Math.floor(w.workers / FLEET.crewPerBoat);
  return boats > 0 ? { b: w.b, boats } : undefined;
}

/** Where boat `i` is in its trip, 0..tripSeconds: boats leave one after another. */
export function boatTime(i: number, boats: number, clock = state.fleetClock): number {
  return (clock + (i / boats) * tripSeconds()) % tripSeconds();
}

export function holdCapacity(): number {
  const b = state.buildings.find((x) => x.type === 'fishingWharf');
  return b ? (BUILDING_BY_ID.fishingWharf.fleet?.hold(b.level) ?? 0) : 0;
}

export const holdCount = (): number => Object.values(state.wharfHold).reduce((sum, n) => sum + n, 0);

/** One boat's catch: Harbor fish, weighted by the wharf's level. */
function haul(level: number): string[] {
  const weights = Object.entries(FLEET.catch[level] ?? FLEET.catch[1]) as [string, number][];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  const fish: string[] = [];
  for (let k = 0; k < (BUILDING_BY_ID.fishingWharf.fleet?.haul(level) ?? 0); k++) {
    let roll = Math.random() * total;
    const hit = weights.find(([, w]) => (roll -= w) <= 0) ?? weights[0];
    fish.push(hit[0]);
  }
  return fish;
}

/** Unloads a boat into the hold; what doesn't fit is sold off at plain value. */
function unload(boat: number, level: number): void {
  const fish = haul(level);
  let surplus = 0;
  for (const id of fish) {
    if (holdCount() < holdCapacity()) state.wharfHold[id] = (state.wharfHold[id] ?? 0) + 1;
    else surplus += FISH.find((f) => f.id === id)!.value;
  }
  state.coins += surplus;
  returns.push({ boat, fish: fish.length });
}

function tickFleet(seconds: number): void {
  const f = fleet();
  if (!f) return;
  const before = state.fleetClock;
  state.fleetClock += seconds;
  const T = tripSeconds();
  for (let i = 0; i < f.boats; i++) {
    const offset = (i / f.boats) * T;
    const trips = Math.floor((state.fleetClock + offset) / T) - Math.floor((before + offset) / T);
    for (let k = 0; k < trips; k++) unload(i, f.b.level);
  }
}

/** The fish with the most in the wharf's hold (the Cannery works through those first). */
function nextForCanning(): string | undefined {
  let best: string | undefined;
  let most = 0;
  for (const [id, n] of Object.entries(state.wharfHold)) {
    if (n > most) {
      most = n;
      best = id;
    }
  }
  return best;
}

export function tickTrade(seconds: number): void {
  tickFleet(seconds);

  // Canning
  const rate = canningRate();
  if (rate > 0 && state.cans < TRADE.maxCans) {
    state.canProgress += (rate * seconds) / 60;
    while (state.canProgress >= 1 && state.cans < TRADE.maxCans) {
      const fish = nextForCanning();
      if (!fish) {
        state.canProgress = 0;
        break;
      }
      state.wharfHold[fish]--;
      if (state.wharfHold[fish] <= 0) delete state.wharfHold[fish];
      state.canProgress -= 1;
      state.cans++;
      state.cansValue += FISH.find((f) => f.id === fish)!.value * TRADE.canValue;
    }
  }

  // Trade ships
  const capacity = shipCapacity();
  if (capacity === 0) return;
  state.shipTimer += seconds;
  while (state.shipTimer >= shipInterval()) {
    state.shipTimer -= shipInterval();
    const load = Math.min(state.cans, capacity);
    if (load === 0) continue;
    const value = (state.cansValue / state.cans) * load;
    const coins = Math.round(value * (1 + perkBonus('exportDeals') + (projectDone('tradeOffice') ? 0.2 : 0)));
    state.cans -= load;
    state.cansValue -= value;
    state.coins += coins;
    visits.push({ cans: load, coins });
    queueToast(`Trade ship took ${load} cans: +$${coins}`);
  }
}
