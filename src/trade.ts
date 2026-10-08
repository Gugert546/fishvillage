// Canning and export: the Cannery turns spare fish on ice into cans, trade ships buy them.

import { BUILDING_BY_ID, FISH, TRADE } from './config';
import { onIce, reservedFish, unstoreFish } from './crates';
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

function staffed(type: 'cannery' | 'exportDocks'): { b: PlacedBuilding; workers: number } | undefined {
  const b = state.buildings.find((x) => x.type === type);
  if (!b || !isWorking(b, wateredTiles())) return undefined;
  const workers = workerCounts().get(b.id) ?? 0;
  return workers > 0 ? { b, workers } : undefined;
}

/** Cans per minute the Cannery can make right now (if it has spare fish). */
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

/** The fish on ice with the most spare (not promised to orders or the house), or undefined. */
function spareFish(): string | undefined {
  let best: string | undefined;
  let most = 0;
  for (const id of Object.keys(state.crates)) {
    // Legendaries are too precious to can.
    if (FISH.find((f) => f.id === id)?.legendary) continue;
    const spare = onIce(id) - reservedFish(id);
    if (spare > most) {
      most = spare;
      best = id;
    }
  }
  return best;
}

export function tickTrade(seconds: number): void {
  // Canning
  const rate = canningRate();
  if (rate > 0 && state.cans < TRADE.maxCans) {
    state.canProgress += (rate * seconds) / 60;
    while (state.canProgress >= 1 && state.cans < TRADE.maxCans) {
      const fish = spareFish();
      if (!fish) {
        state.canProgress = 0;
        break;
      }
      unstoreFish(fish, 1);
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
