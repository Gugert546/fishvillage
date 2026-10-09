// Resident requests: now and then someone would love a decoration near home, a road by the door,
// or a job somewhere in particular. Fulfil it and they're happier for good (and you get coins).

import { BUILDINGS, BUILDING_BY_ID, REQUESTS, type BuildingId } from './config';
import { touchesRoad } from './happiness';
import { jobSlots, tileGap } from './population';
import { queueToast } from './quests';
import { save, state, type PlacedBuilding, type Request, type Resident } from './state';
import { isUnlocked, townLevel } from './town';

export const requestsUnlocked = (): boolean => townLevel() >= REQUESTS.unlockLevel;

const residentOf = (q: Request): Resident | undefined => state.residents.find((r) => r.id === q.resident);
const homeOf = (r: Resident | undefined): PlacedBuilding | undefined => (r ? state.buildings.find((b) => b.id === r.home) : undefined);

const decorNear = (type: BuildingId, home: PlacedBuilding) =>
  state.buildings.some((b) => b.type === type && tileGap(b, home) <= REQUESTS.nearTiles);

const pick = <T>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

/** A request this resident could make right now, or undefined. */
function draft(r: Resident): Omit<Request, 'id' | 'coins'> | undefined {
  const home = homeOf(r);
  if (!home) return undefined;
  const kinds: Omit<Request, 'id' | 'coins'>[] = [];
  const decor = pick(BUILDINGS.filter((d) => d.category === 'decor' && d.w === 1 && isUnlocked(d) && !d.merchantOnly && !d.needsWater && !decorNear(d.id, home)));
  if (decor) kinds.push({ resident: r.id, kind: 'decor', target: decor.id });
  if (!touchesRoad(home)) kinds.push({ resident: r.id, kind: 'road' });
  const current = r.job === null ? undefined : state.buildings.find((b) => b.id === r.job)?.type;
  const job = pick([...new Set(state.buildings.filter((b) => jobSlots(b) > 0 && b.type !== current).map((b) => b.type))]);
  if (job) kinds.push({ resident: r.id, kind: 'job', target: job });
  return pick(kinds);
}

/** Posts new requests over time (never two from the same person). */
export function tickRequests(seconds: number): void {
  const alive = new Set(state.residents.map((r) => r.id));
  state.requests = state.requests.filter((q) => alive.has(q.resident));
  if (!requestsUnlocked() || state.requests.length >= REQUESTS.max) {
    state.requestTimer = 0;
    return;
  }
  state.requestTimer += seconds;
  if (state.requestTimer < REQUESTS.everySeconds) return;
  state.requestTimer = 0;
  const asking = new Set(state.requests.map((q) => q.resident));
  const r = pick(state.residents.filter((x) => !asking.has(x.id)));
  const d = r && draft(r);
  if (!d) return;
  const q: Request = { ...d, id: state.nextRequestId++, coins: REQUESTS.rewardPerLevel * townLevel() };
  state.requests.push(q);
  queueToast(`${r!.name} has a request`);
}

export function requestDone(q: Request): boolean {
  const r = residentOf(q);
  const home = homeOf(r);
  if (!r || !home) return false;
  if (q.kind === 'decor') return decorNear(q.target!, home);
  if (q.kind === 'road') return touchesRoad(home);
  return r.job !== null && state.buildings.find((b) => b.id === r.job)?.type === q.target;
}

/** Rewards any request that has come true (called once a second). */
export function checkRequests(): void {
  for (const q of [...state.requests]) {
    if (!requestDone(q)) continue;
    const r = residentOf(q)!;
    r.cheer = Math.min(REQUESTS.maxCheer, (r.cheer ?? 0) + REQUESTS.cheer);
    state.coins += q.coins;
    state.requests = state.requests.filter((x) => x !== q);
    queueToast(`${r.name} is delighted! +$${q.coins}`);
    save();
  }
}

export function describeRequest(q: Request): string {
  const name = residentOf(q)?.name ?? 'Someone';
  const thing = q.target ? BUILDING_BY_ID[q.target].name : '';
  if (q.kind === 'decor') return `${name} would love a ${thing} near home`;
  if (q.kind === 'road') return `${name} wishes for a road by the door`;
  return `${name} dreams of working at the ${thing}`;
}

/** How to make it happen, in a few words. */
export function requestHint(q: Request): string {
  if (q.kind === 'decor') return `Build one within ${REQUESTS.nearTiles} tiles of their home`;
  if (q.kind === 'road') return 'Paint a road next to their home';
  return 'Pick their job in the Residents list';
}

export function dismissRequest(q: Request): void {
  state.requests = state.requests.filter((x) => x !== q);
  save();
}

/** Homes with an open request, for the "!" bubbles in town. */
export function requestHomes(): Set<number> {
  return new Set(state.requests.map((q) => residentOf(q)?.home).filter((id): id is number => id !== undefined));
}
