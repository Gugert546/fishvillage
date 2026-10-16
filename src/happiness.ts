// Happiness: how residents feel about where they live, and what that does for the town.

import { ARRANGEMENT_BY_ID, FESTIVAL, HAPPINESS, STREET, WAGES } from './config';
import { findArrangements, type Arrangement } from './arrangements';
import { tourismIncome } from './tourism';
import { festivalBonus } from './festival';
import { deliveryBoost } from './crates';
import { landmarkBonus, perkBonus } from './perks';
import { speciesCount } from './logbook';
import { defOf, tileGap, workerCounts } from './population';
import { millBoost, tavernMood } from './services';
import { isWorking, touchesWater, wateredTiles } from './water';
import { state, type PlacedBuilding, type Resident } from './state';

/** One kind of thing near a home and what it adds up to there, e.g. "Flower Bed ×3 +5". */
export interface MoodSource {
  label: string;
  count: number;
  value: number;
}

export interface HomeMood {
  base: number;
  road: number;
  water: number;
  /** Town-wide: Cheerful perk, the Harbor Gate and festivals. */
  town: number;
  /** Decorations, services and the square nearby, after falloff, repeats and diminishing returns. */
  surroundings: number;
  /** Smell and noise from nearby workplaces (zero or less), after screening. */
  nuisance: number;
  /** Flat bonuses from arrangements reaching this home (each type once). */
  arranged: number;
  /** What makes up `surroundings`, biggest first. */
  sources: MoodSource[];
  /** What makes up `nuisance` (negative values), worst first. */
  nuisances: MoodSource[];
  /** What makes up `arranged`, e.g. "Park +6". */
  arrangements: MoodSource[];
  /** base + road + water + town + surroundings + nuisance + arranged, before the per-resident job modifier. */
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

/** Share of an effect that reaches a home `gap` tiles away: all of it when touching, less toward the edge. */
export function falloff(gap: number, radius: number): number {
  return radius > 0 ? 1 - HAPPINESS.edgeFalloff * (gap / radius) : 1;
}

/**
 * Happiness a decoration would give a home on its own (after distance falloff), or 0 if out of
 * range (or a boat with no water). Variety and diminishing returns come on top, in homeMood.
 */
export function decorBonus(decor: PlacedBuilding, home: PlacedBuilding, wet?: Set<string>): number {
  const effect = defOf(decor).happiness;
  if (!effect || decor === home) return 0;
  const gap = tileGap(decor, home);
  if (gap > effect.radius) return 0;
  if (defOf(decor).needsWater && !touchesWater(decor, wet ?? wateredTiles())) return 0;
  return effect.amount * falloff(gap, effect.radius);
}

/** Smell or noise a workplace puts on a home (a positive amount to take away), before screening. */
export function nuisanceOn(b: PlacedBuilding, home: PlacedBuilding): number {
  const n = defOf(b).nuisance;
  if (!n || b === home) return 0;
  const gap = tileGap(b, home);
  return gap > n.radius ? 0 : n.amount * falloff(gap, n.radius);
}

/**
 * A home's mood from where it stands. `buildings` can stand in for the town, e.g. with a building
 * being placed added (and the one being moved left out) to preview the change.
 */
export function homeMood(
  home: PlacedBuilding,
  roads = roadTiles(),
  wet = wateredTiles(),
  buildings: readonly PlacedBuilding[] = state.buildings,
  layouts: Arrangement[] = findArrangements(buildings, wet),
): HomeMood {
  const counts = workerCounts();
  const byType = new Map<string, { label: string; values: number[] }>();
  const bad = new Map<string, MoodSource>();
  let screens = 0;
  for (const b of buildings) {
    if (b === home) continue;
    const def = defOf(b);
    const gap = tileGap(b, home);
    let cheer = decorBonus(b, home, wet);
    if (def.moodPerWorker) cheer += tavernMood(b, gap, counts, wet) * falloff(gap, def.moodPerWorker.radius);
    if (cheer > 0) {
      const entry = byType.get(def.id) ?? { label: def.name, values: [] };
      entry.values.push(cheer);
      byType.set(def.id, entry);
    }
    const harm = nuisanceOn(b, home);
    if (harm > 0) {
      const entry = bad.get(def.id) ?? { label: `${def.name} ${def.nuisance!.kind}`, count: 0, value: 0 };
      entry.count++;
      entry.value -= harm;
      bad.set(def.id, entry);
    }
    if (def.screens && gap === 0) screens++;
  }

  // Variety: the best of each type counts fully, repeats count less.
  const entries: { type: string; value: number }[] = [];
  for (const [type, { values }] of byType) {
    values.sort((a, b) => b - a);
    values.forEach((v, i) => entries.push({ type, value: i === 0 ? v : v * HAPPINESS.repeatShare }));
  }
  // Diminishing returns: biggest first, each counting less than the one before.
  entries.sort((a, b) => b.value - a.value);
  const sources = new Map<string, MoodSource>();
  let weight = 1;
  let surroundings = 0;
  for (const e of entries) {
    const v = e.value * weight;
    weight *= HAPPINESS.diminish;
    surroundings += v;
    const source = sources.get(e.type) ?? { label: byType.get(e.type)!.label, count: 0, value: 0 };
    source.count++;
    source.value += v;
    sources.set(e.type, source);
  }

  // Trees hugging the home soften smell and noise.
  const kept = 1 - Math.min(HAPPINESS.screenMax, screens * HAPPINESS.screenPerTree);
  const nuisances = [...bad.values()].map((n) => ({ ...n, value: n.value * kept })).sort((a, b) => a.value - b.value);
  const nuisance = nuisances.reduce((sum, n) => sum + n.value, 0);

  // Arrangements: a flat bonus per type reaching this home.
  const kinds = new Set(layouts.filter((a) => a.homes.has(home)).map((a) => a.id));
  const arrangements = [...kinds].map((id) => ({ label: ARRANGEMENT_BY_ID[id].name, count: 1, value: ARRANGEMENT_BY_ID[id].bonus }));
  const arranged = arrangements.reduce((sum, a) => sum + a.value, 0);

  const road = touchesRoad(home, roads) ? HAPPINESS.roadNextToHome : 0;
  const water = touchesWater(home, wet) ? HAPPINESS.waterNextToHome : 0;
  const town = perkBonus('cheerful') + landmarkBonus('happiness') + festivalBonus(FESTIVAL.happiness);
  return {
    base: HAPPINESS.base,
    road,
    water,
    town,
    surroundings,
    nuisance,
    sources: [...sources.values()].sort((a, b) => b.value - a.value),
    nuisances,
    arranged,
    arrangements: arrangements.sort((a, b) => b.value - a.value),
    total: HAPPINESS.base + road + water + town + surroundings + nuisance + arranged,
  };
}

const emptyMood = (): HomeMood => ({
  base: HAPPINESS.base,
  road: 0,
  water: 0,
  town: 0,
  surroundings: 0,
  nuisance: 0,
  arranged: 0,
  sources: [],
  nuisances: [],
  arrangements: [],
  total: HAPPINESS.base,
});

export function residentHappiness(r: Resident, mood: HomeMood): number {
  return clamp(mood.total + (r.cheer ?? 0) + (r.job !== null ? HAPPINESS.employed : HAPPINESS.unemployed));
}

/** Happiness of every resident, computed in one pass. */
export function happinessByResident(): Map<number, number> {
  const roads = roadTiles();
  const wet = wateredTiles();
  const layouts = findArrangements(state.buildings, wet);
  const moods = new Map<number, HomeMood>();
  const out = new Map<number, number>();
  for (const r of state.residents) {
    let mood = moods.get(r.home);
    if (!mood) {
      const home = state.buildings.find((b) => b.id === r.home);
      mood = home ? homeMood(home, roads, wet, state.buildings, layouts) : emptyMood();
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
  total *= 1 + streetBonus(b, roads);
  total *= townIncomeMultiplier();
  return total * (touchesRoad(b, roads) ? 1 + HAPPINESS.roadIncomeBonus : 1);
}

/** Base coins per minute for one worker here, before mood and boosts (the Aquarium grows with the logbook). */
export function incomePerWorkerOf(b: PlacedBuilding): number {
  const def = defOf(b);
  if (def.speciesIncomePerWorker) return def.speciesIncomePerWorker(b.level) * speciesCount();
  return def.incomePerWorker?.(b.level) ?? 0;
}

/**
 * Market street: an earning shop by a road does better with other road-side shops close by
 * (+5% for each within 3 tiles, up to +25%).
 */
export function streetBonus(b: PlacedBuilding, roads = roadTiles()): number {
  const earns = (x: PlacedBuilding) => !!(defOf(x).incomePerWorker || defOf(x).speciesIncomePerWorker);
  if (!earns(b) || !touchesRoad(b, roads)) return 0;
  const neighbours = state.buildings.filter((x) => x !== b && earns(x) && tileGap(b, x) <= STREET.radius && touchesRoad(x, roads)).length;
  return Math.min(STREET.max, neighbours * STREET.perShop);
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
  const shops = state.buildings.reduce((sum, b) => sum + workplaceIncome(b, byResident, roads, fillets, wet), 0);
  return shops + tourismIncome(townHappiness(byResident));
}
