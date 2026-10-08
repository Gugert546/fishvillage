// Happiness: how residents feel about where they live, and what that does for the town.

import { FESTIVAL, HAPPINESS, WAGES } from './config';
import { festivalBonus } from './festival';
import { deliveryBoost } from './crates';
import { landmarkBonus, perkBonus } from './perks';
import { speciesCount } from './logbook';
import { defOf, tileGap, workerCounts } from './population';
import { millBoost, tavernMood } from './services';
import { isWorking, touchesWater, wateredTiles } from './water';
import { state, type PlacedBuilding, type Resident } from './state';

export interface HomeMood {
  base: number;
  decor: number;
  road: number;
  water: number;
  tavern: number;
  /** Town-wide: Cheerful perk and the Harbor Gate. */
  town: number;
  /** base + decor + road + water + tavern + town, before the per-resident job modifier. */
  total: number;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

function roadTiles(): Set<string> {
  const tiles = new Set<string>();
  // Bridges carry the road over canals, so they count as road too.
  for (const b of state.buildings) if (b.type === 'road' || b.type === 'bridge') tiles.add(`${b.col},${b.row}`);
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

/** Happiness a decoration gives a home, or 0 if out of range (or a boat with no water). */
export function decorBonus(decor: PlacedBuilding, home: PlacedBuilding, wet?: Set<string>): number {
  const effect = defOf(decor).happiness;
  if (!effect || tileGap(decor, home) > effect.radius) return 0;
  if (!defOf(decor).needsWater) return effect.amount;
  return touchesWater(decor, wet ?? wateredTiles()) ? effect.amount : 0;
}

export function homeMood(home: PlacedBuilding, roads = roadTiles(), wet = wateredTiles()): HomeMood {
  let decor = 0;
  let tavern = 0;
  const counts = workerCounts();
  for (const b of state.buildings) {
    decor += decorBonus(b, home, wet);
    if (defOf(b).moodPerWorker) tavern += tavernMood(b, tileGap(b, home), counts, wet);
  }
  const road = touchesRoad(home, roads) ? HAPPINESS.roadNextToHome : 0;
  const water = touchesWater(home, wet) ? HAPPINESS.waterNextToHome : 0;
  const town = perkBonus('cheerful') + landmarkBonus('happiness') + festivalBonus(FESTIVAL.happiness);
  return { base: HAPPINESS.base, decor, road, water, tavern, town, total: HAPPINESS.base + decor + road + water + tavern + town };
}

export function residentHappiness(r: Resident, mood: HomeMood): number {
  return clamp(mood.total + (r.job !== null ? HAPPINESS.employed : HAPPINESS.unemployed));
}

/** Happiness of every resident, computed in one pass. */
export function happinessByResident(): Map<number, number> {
  const roads = roadTiles();
  const wet = wateredTiles();
  const moods = new Map<number, HomeMood>();
  const out = new Map<number, number>();
  for (const r of state.residents) {
    let mood = moods.get(r.home);
    if (!mood) {
      const home = state.buildings.find((b) => b.id === r.home);
      mood = home
        ? homeMood(home, roads, wet)
        : { base: HAPPINESS.base, decor: 0, road: 0, water: 0, tavern: 0, town: 0, total: HAPPINESS.base };
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

/** Extra Fish Stand income from Fillet House workers (each powered up by nearby mills), e.g. 0.3 = +30%. */
export function filletBoost(counts = workerCounts(), wet = wateredTiles()): number {
  let boost = 0;
  for (const b of state.buildings) {
    const perWorker = defOf(b).standBoostPerWorker?.(b.level);
    if (!perWorker) continue;
    boost += perWorker * (counts.get(b.id) ?? 0) * (1 + millBoost(b, counts, wet));
  }
  return boost;
}

/** Coins per minute for one workplace, given its workers' moods and road access. */
export function workplaceIncome(
  b: PlacedBuilding,
  byResident = happinessByResident(),
  roads = roadTiles(),
  fillets = filletBoost(),
  wet = wateredTiles(),
): number {
  const perWorker = incomePerWorkerOf(b);
  if (perWorker === 0 || !isWorking(b, wet)) return 0;
  let total = 0;
  for (const r of state.residents) {
    if (r.job === b.id) total += perWorker * incomeMultiplier(byResident.get(r.id) ?? 50);
  }
  if (b.type === 'fishStand') total *= 1 + fillets;
  total *= 1 + millBoost(b, undefined, wet);
  total *= 1 + deliveryBoost(b);
  total *= townIncomeMultiplier();
  return total * (touchesRoad(b, roads) ? 1 + HAPPINESS.roadIncomeBonus : 1);
}

/** Base coins per minute for one worker here, before mood and boosts (the Aquarium grows with the logbook). */
export function incomePerWorkerOf(b: PlacedBuilding): number {
  const def = defOf(b);
  if (def.speciesIncomePerWorker) return def.speciesIncomePerWorker(b.level) * speciesCount();
  return def.incomePerWorker?.(b.level) ?? 0;
}

/** Town-wide income boost from perks and the Clock Tower. */
export function townIncomeMultiplier(): number {
  return 1 + perkBonus('shopkeeping') + perkBonus('prosperity') + landmarkBonus('income') + festivalBonus(FESTIVAL.income);
}

/**
 * What one worker here is paid per minute: a share of what a typical worker at this building's
 * tier earns, a little more per building level.
 */
export function wagePerWorker(b: PlacedBuilding): number {
  const def = defOf(b);
  if (!def.jobs) return 0;
  const grade = def.incomePerWorker?.(1) ?? WAGES.grade[def.unlockLevel ?? 1] ?? WAGES.grade[WAGES.grade.length - 1];
  const service = def.incomePerWorker || def.speciesIncomePerWorker ? 1 : WAGES.serviceFactor;
  return WAGES.share * grade * service * (1 + WAGES.perLevel * (b.level - 1));
}

/** All wages in town per minute. */
export function totalWages(counts = workerCounts()): number {
  return state.buildings.reduce((sum, b) => sum + wagePerWorker(b) * (counts.get(b.id) ?? 0), 0);
}

/** Coins per minute for the whole town. */
export function totalIncome(): number {
  const byResident = happinessByResident();
  const roads = roadTiles();
  const wet = wateredTiles();
  const fillets = filletBoost(undefined, wet);
  return state.buildings.reduce((sum, b) => sum + workplaceIncome(b, byResident, roads, fillets, wet), 0);
}
