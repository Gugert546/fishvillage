// Residents: who lives where, who works where, and when new people arrive.

import {
  BUILDING_BY_ID,
  FIRST_MOVE_IN_SECONDS,
  MOVE_IN_SECONDS,
  RESIDENT_NAMES,
  type BuildingDef,
  type BuildingId,
} from './config';
import { state, type PlacedBuilding, type Resident } from './state';

export const defOf = (b: PlacedBuilding): BuildingDef => BUILDING_BY_ID[b.type];

/** Empty tiles between two footprints (0 when touching), measured Chebyshev-style. */
export function tileGap(a: PlacedBuilding, b: PlacedBuilding): number {
  const da = defOf(a);
  const db = defOf(b);
  const gx = Math.max(0, a.col - (b.col + db.w), b.col - (a.col + da.w));
  const gy = Math.max(0, a.row - (b.row + db.h), b.row - (a.row + da.h));
  return Math.max(gx, gy);
}

export function isWorkplace(b: PlacedBuilding): boolean {
  return !!defOf(b).jobs;
}

export function housingOf(b: PlacedBuilding): number {
  return defOf(b).housing?.(b.level) ?? 0;
}

export function jobSlots(b: PlacedBuilding): number {
  return defOf(b).jobs?.(b.level) ?? 0;
}

/** How many workers this workplace should get: the player's staff setting, capped by slots. */
export function staffTarget(b: PlacedBuilding): number {
  return Math.min(jobSlots(b), b.staff ?? Infinity);
}

export function housingCapacity(): number {
  return state.buildings.reduce((sum, b) => sum + housingOf(b), 0);
}

export function residentsOf(b: PlacedBuilding): Resident[] {
  return state.residents.filter((r) => r.home === b.id);
}

export function workersOf(b: PlacedBuilding): Resident[] {
  return state.residents.filter((r) => r.job === b.id);
}

export function workerCounts(): Map<number, number> {
  const counts = new Map<number, number>();
  for (const r of state.residents) if (r.job !== null) counts.set(r.job, (counts.get(r.job) ?? 0) + 1);
  return counts;
}

export function totalJobs(): number {
  return state.buildings.reduce((sum, b) => sum + jobSlots(b), 0);
}

export function unemployedCount(): number {
  return state.residents.filter((r) => r.job === null).length;
}

/** A shop sells gear only while someone works there. */
export function shopOpen(type: BuildingId): boolean {
  const counts = workerCounts();
  return state.buildings.some((b) => b.type === type && (counts.get(b.id) ?? 0) > 0);
}

/**
 * Fill open job slots without moving anyone: a resident who has a job keeps it until the player
 * moves them. A job only ends when its workplace is gone or has more workers than its staff
 * setting allows (the player lowered it); then hand-picked ("pinned") workers stay and the
 * newest auto-assigned ones leave first. Open slots go to the unemployed, priority workplaces
 * first. Residents the player set to "No job" stay unemployed.
 */
export function assignJobs(): void {
  const workplaces = state.buildings
    .filter(isWorkplace)
    .sort((a, b) => Number(!!b.priority) - Number(!!a.priority) || a.id - b.id);
  const workplaceIds = new Set(workplaces.map((w) => w.id));

  // Jobs at workplaces that are gone end (and go back to auto).
  for (const r of state.residents) {
    if (r.job !== null && !workplaceIds.has(r.job)) {
      r.job = null;
      r.pinned = false;
    }
  }

  // Over the staff setting: auto-assigned workers leave first, newest first.
  for (const w of workplaces) {
    const here = state.residents
      .filter((r) => r.job === w.id)
      .sort((a, b) => Number(!!a.pinned) - Number(!!b.pinned) || b.id - a.id);
    for (const r of here.slice(0, Math.max(0, here.length - staffTarget(w)))) {
      r.job = null;
      r.pinned = false;
    }
  }

  const unemployed = state.residents.filter((r) => r.job === null && !r.pinned);
  for (const w of workplaces) {
    let have = state.residents.filter((r) => r.job === w.id).length;
    while (have < staffTarget(w) && unemployed.length > 0) {
      unemployed.shift()!.job = w.id;
      have++;
    }
  }
}

function pickName(): string {
  const used = new Set(state.residents.map((r) => r.name));
  const free = RESIDENT_NAMES.filter((n) => !used.has(n));
  const pool = free.length > 0 ? free : RESIDENT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Moves one resident into the oldest house with room. */
function moveIn(): Resident | undefined {
  const home = state.buildings.find((b) => housingOf(b) > residentsOf(b).length);
  if (!home) return undefined;
  const resident: Resident = { id: state.nextResidentId++, name: pickName(), home: home.id, job: null };
  state.residents.push(resident);
  return resident;
}

/** Advances move-ins by `seconds`. Returns residents who arrived. */
export function tickPopulation(seconds: number): Resident[] {
  const arrived: Resident[] = [];
  const capacity = housingCapacity();
  if (state.residents.length < capacity) {
    state.moveInTimer += seconds;
    while (state.residents.length < capacity) {
      const wait = state.residents.length === 0 ? FIRST_MOVE_IN_SECONDS : MOVE_IN_SECONDS;
      if (state.moveInTimer < wait) break;
      const r = moveIn();
      if (!r) break;
      state.moveInTimer -= wait;
      arrived.push(r);
    }
  }
  if (state.residents.length >= capacity) state.moveInTimer = 0;
  if (arrived.length > 0) assignJobs();
  return arrived;
}

/**
 * Called before a building is removed: its residents move to other free homes (or leave town if
 * there's no room), and its workers go back to the job pool.
 */
export function evictFrom(b: PlacedBuilding): void {
  for (const r of residentsOf(b)) {
    const newHome = state.buildings.find((h) => h !== b && housingOf(h) > residentsOf(h).length);
    if (newHome) r.home = newHome.id;
    else state.residents = state.residents.filter((other) => other !== r);
  }
  for (const r of workersOf(b)) r.job = null;
}

/** Workers placed here by hand; these can't be bumped to make room. */
export function pinnedWorkers(b: PlacedBuilding): number {
  return state.residents.filter((r) => r.pinned && r.job === b.id).length;
}

/**
 * The player picks a job for a resident: a workplace, null for "no job", or "auto" to hand the
 * choice back to the town. Picking a full workplace bumps one of its auto-assigned workers.
 */
export function chooseJob(r: Resident, job: number | null | 'auto'): boolean {
  if (job === 'auto') {
    r.pinned = false;
  } else if (job === null) {
    r.pinned = true;
    r.job = null;
  } else {
    const b = state.buildings.find((x) => x.id === job);
    if (!b || !isWorkplace(b)) return false;
    if (r.job !== job && pinnedWorkers(b) >= jobSlots(b)) return false;
    r.pinned = true;
    r.job = job;
    // Keep the staff setting from fighting the hand-picked workers.
    if (b.staff !== undefined && b.staff < pinnedWorkers(b)) b.staff = pinnedWorkers(b);
  }
  assignJobs();
  return true;
}
