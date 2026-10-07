// Happiness: how residents feel about where they live, and what that does for the town.

import { HAPPINESS } from './config';
import { defOf } from './population';
import { state, type PlacedBuilding, type Resident } from './state';

export interface HomeMood {
  base: number;
  decor: number;
  road: number;
  /** base + decor + road, before the per-resident job modifier. */
  total: number;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Empty tiles between two footprints (0 when touching), measured Chebyshev-style. */
export function tileGap(a: PlacedBuilding, b: PlacedBuilding): number {
  const da = defOf(a);
  const db = defOf(b);
  const gx = Math.max(0, a.col - (b.col + db.w), b.col - (a.col + da.w));
  const gy = Math.max(0, a.row - (b.row + db.h), b.row - (a.row + da.h));
  return Math.max(gx, gy);
}

function roadTiles(): Set<string> {
  const tiles = new Set<string>();
  for (const b of state.buildings) if (b.type === 'road') tiles.add(`${b.col},${b.row}`);
  return tiles;
}

/** Whether any tile directly beside the footprint (not diagonal) is a road. */
export function touchesRoad(b: PlacedBuilding, roads = roadTiles()): boolean {
  const { w, h } = defOf(b);
  for (let c = b.col; c < b.col + w; c++) {
    if (roads.has(`${c},${b.row - 1}`) || roads.has(`${c},${b.row + h}`)) return true;
  }
  for (let r = b.row; r < b.row + h; r++) {
    if (roads.has(`${b.col - 1},${r}`) || roads.has(`${b.col + w},${r}`)) return true;
  }
  return false;
}

/** Happiness a decoration gives a home, or 0 if out of range. */
export function decorBonus(decor: PlacedBuilding, home: PlacedBuilding): number {
  const effect = defOf(decor).happiness;
  if (!effect) return 0;
  return tileGap(decor, home) <= effect.radius ? effect.amount : 0;
}

export function homeMood(home: PlacedBuilding, roads = roadTiles()): HomeMood {
  let decor = 0;
  for (const b of state.buildings) decor += decorBonus(b, home);
  const road = touchesRoad(home, roads) ? HAPPINESS.roadNextToHome : 0;
  return { base: HAPPINESS.base, decor, road, total: HAPPINESS.base + decor + road };
}

export function residentHappiness(r: Resident, mood: HomeMood): number {
  return clamp(mood.total + (r.job !== null ? HAPPINESS.employed : HAPPINESS.unemployed));
}

/** Happiness of every resident, computed in one pass. */
export function happinessByResident(): Map<number, number> {
  const roads = roadTiles();
  const moods = new Map<number, HomeMood>();
  const out = new Map<number, number>();
  for (const r of state.residents) {
    let mood = moods.get(r.home);
    if (!mood) {
      const home = state.buildings.find((b) => b.id === r.home);
      mood = home ? homeMood(home, roads) : { base: HAPPINESS.base, decor: 0, road: 0, total: HAPPINESS.base };
      moods.set(r.home, mood);
    }
    out.set(r.id, residentHappiness(r, mood));
  }
  return out;
}

/** Average over residents, or null in an empty town. */
export function townHappiness(byResident = happinessByResident()): number | null {
  if (byResident.size === 0) return null;
  let sum = 0;
  for (const h of byResident.values()) sum += h;
  return sum / byResident.size;
}

export function averageHappiness(residents: Resident[], byResident = happinessByResident()): number | null {
  if (residents.length === 0) return null;
  return residents.reduce((sum, r) => sum + (byResident.get(r.id) ?? HAPPINESS.base), 0) / residents.length;
}

/** Piecewise-linear scale through (0, atZero), (50, 1), (100, atFull). */
function scale(happiness: number, atZero: number, atFull: number): number {
  const h = clamp(happiness);
  return h <= 50 ? atZero + (1 - atZero) * (h / 50) : 1 + (atFull - 1) * ((h - 50) / 50);
}

export const incomeMultiplier = (h: number) => scale(h, HAPPINESS.incomeAtZero, HAPPINESS.incomeAtFull);
export const moveInMultiplier = (h: number) => scale(h, HAPPINESS.moveInAtZero, HAPPINESS.moveInAtFull);

/** Coins per minute for one workplace, given its workers' moods and road access. */
export function workplaceIncome(b: PlacedBuilding, byResident = happinessByResident(), roads = roadTiles()): number {
  const perWorker = defOf(b).incomePerWorker?.(b.level) ?? 0;
  if (perWorker === 0) return 0;
  let total = 0;
  for (const r of state.residents) {
    if (r.job === b.id) total += perWorker * incomeMultiplier(byResident.get(r.id) ?? 50);
  }
  return total * (touchesRoad(b, roads) ? 1 + HAPPINESS.roadIncomeBonus : 1);
}

/** Coins per minute for the whole town. */
export function totalIncome(): number {
  const byResident = happinessByResident();
  const roads = roadTiles();
  return state.buildings.reduce((sum, b) => sum + workplaceIncome(b, byResident, roads), 0);
}
