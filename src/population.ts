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
 * Distribute residents over workplaces: priority workplaces first, then oldest first, each up to
 * its staff target. Residents keep their current job when it's still wanted, so jobs don't shuffle.
 * Residents whose job the player picked by hand ("pinned") are never moved; they fill their
 * workplace's slots first and everyone else works around them.
 */
export function assignJobs(): void {
  const workplaces = state.buildings
    .filter(isWorkplace)
    .sort((a, b) => Number(!!b.priority) - Number(!!a.priority) || a.id - b.id);
  const workplaceIds = new Set(workplaces.map((w) => w.id));

  // Pinned residents whose workplace is gone go back to auto.
  const pinnedAt = new Map<number, number>();
  for (const r of state.residents) {
    if (!r.pinned || r.job === null) continue;
    if (!workplaceIds.has(r.job)) {
      r.pinned = false;
      r.job = null;
    } else {
      pinnedAt.set(r.job, (pinnedAt.get(r.job) ?? 0) + 1);
    }
  }

  let available = state.residents.filter((r) => !r.pinned).length;
  const wanted = new Map<number, number>();
  for (const w of workplaces) {
    const n = Math.min(Math.max(0, staffTarget(w) - (pinnedAt.get(w.id) ?? 0)), available);
    wanted.set(w.id, n);
    available -= n;
  }

  const filled = new Map<number, number>();
  for (const r of state.residents) {
    if (r.job === null || r.pinned) continue;
    const want = wanted.get(r.job);
    const have = filled.get(r.job) ?? 0;
    if (want === undefined || have >= want) r.job = null;
    else filled.set(r.job, have + 1);
  }

  const unemployed = state.residents.filter((r) => r.job === null && !r.pinned);
  for (const w of workplaces) {
    let have = filled.get(w.id) ?? 0;
    const want = wanted.get(w.id) ?? 0;
    while (have < want && unemployed.length > 0) {
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
