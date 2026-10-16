// Arrangements: layouts the town recognises (a Garden, a Park, a Plaza…). Homes they reach get a
// flat happiness bonus, and the Town Planner's Book records each kind the first time it's built.

import { ARRANGEMENT, ARRANGEMENT_BY_ID, ARRANGEMENTS, type ArrangementId } from './config';
import { defOf, tileGap } from './population';
import { state, type PlacedBuilding } from './state';
import { townLevel } from './town';
import { wateredTiles } from './water';

export interface Arrangement {
  id: ArrangementId;
  /** What it's made of, for placing its label. */
  members: PlacedBuilding[];
  /** Homes that get its bonus. */
  homes: Set<PlacedBuilding>;
}

const key = (col: number, row: number) => `${col},${row}`;
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Side by side: sharing an edge, not just a corner. */
function sideBySide(a: PlacedBuilding, b: PlacedBuilding): boolean {
  const da = defOf(a);
  const db = defOf(b);
  const overlapCols = a.col < b.col + db.w && b.col < a.col + da.w;
  const overlapRows = a.row < b.row + db.h && b.row < a.row + da.h;
  const besideX = a.col + da.w === b.col || b.col + db.w === a.col;
  const besideY = a.row + da.h === b.row || b.row + db.h === a.row;
  return (besideX && overlapRows) || (besideY && overlapCols);
}

/** Tiles directly beside a footprint (not diagonal). */
function tilesBeside(b: PlacedBuilding): string[] {
  const { w, h } = defOf(b);
  const out: string[] = [];
  for (let c = b.col; c < b.col + w; c++) out.push(key(c, b.row - 1), key(c, b.row + h));
  for (let r = b.row; r < b.row + h; r++) out.push(key(b.col - 1, r), key(b.col + w, r));
  return out;
}

const isHome = (b: PlacedBuilding) => !!defOf(b).housing;
const isRoad = (b: PlacedBuilding) => b.type === 'road' || b.type === 'bridge';

// The live town's arrangements, reused until a building is placed, moved or removed (they're
// asked for several times a frame by income, happiness and tourism).
let cache: { layout: string; found: Arrangement[] } | undefined;
const layoutKey = (buildings: readonly PlacedBuilding[]) => buildings.map((b) => `${b.id}:${b.col},${b.row}`).join(';');

/** Every arrangement in a town (by default this one; a preview passes its own list). */
export function findArrangements(buildings: readonly PlacedBuilding[] = state.buildings, wet?: Set<string>): Arrangement[] {
  if (buildings !== state.buildings) return detect(buildings, wet ?? wateredTiles());
  const layout = layoutKey(buildings);
  if (cache?.layout !== layout) cache = { layout, found: detect(buildings, wet ?? wateredTiles()) };
  return cache.found;
}

function detect(buildings: readonly PlacedBuilding[], wet: Set<string>): Arrangement[] {
  // Roads on their own map, so a lamp post standing on one doesn't hide it.
  const at = new Map<string, PlacedBuilding>();
  const roadMap = new Map<string, PlacedBuilding>();
  for (const b of buildings) {
    if (isRoad(b)) {
      roadMap.set(key(b.col, b.row), b);
      continue;
    }
    const { w, h } = defOf(b);
    for (let c = b.col; c < b.col + w; c++) for (let r = b.row; r < b.row + h; r++) at.set(key(c, r), b);
  }
  const homes = buildings.filter(isHome);
  const near = (members: PlacedBuilding[], radius: number) =>
    new Set(homes.filter((h) => members.some((m) => tileGap(m, h) <= radius)));
  const found: Arrangement[] = [];

  // Garden: flower beds hugging a home.
  for (const home of homes) {
    const beds = buildings.filter((b) => b.type === 'flowerBed' && tileGap(b, home) === 0);
    const need = home.type === 'apartment' ? ARRANGEMENT.gardenBedsApartment : ARRANGEMENT.gardenBeds;
    if (beds.length >= need) found.push({ id: 'garden', members: [home, ...beds], homes: new Set([home]) });
  }

  // Park: a group of decorations side by side, with trees, a bench and flowers in it.
  const decor = buildings.filter((b) => defOf(b).category === 'decor');
  const seen = new Set<PlacedBuilding>();
  for (const start of decor) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (let i = 0; i < group.length; i++) {
      for (const other of decor) {
        if (!seen.has(other) && sideBySide(group[i], other)) {
          seen.add(other);
          group.push(other);
        }
      }
    }
    const count = (type: string) => group.filter((b) => b.type === type).length;
    if (group.length >= ARRANGEMENT.parkSize && count('tree') >= 2 && count('bench') >= 1 && count('flowerBed') >= 1) {
      found.push({ id: 'park', members: group, homes: near(group, ARRANGEMENT.parkRadius) });
    }
  }

  // Plaza: a fountain by a road, gathered around with benches and lamps.
  for (const centre of buildings) {
    if (centre.type !== 'fountain' && centre.type !== 'koiPond') continue;
    if (!tilesBeside(centre).some((k) => roadMap.has(k))) continue;
    const around = (type: string) => buildings.filter((b) => b.type === type && tileGap(b, centre) <= ARRANGEMENT.plazaGather);
    const benches = around('bench');
    const lamps = around('lampPost');
    if (benches.length >= 2 && lamps.length >= 2) {
      found.push({ id: 'plaza', members: [centre, ...benches, ...lamps], homes: near([centre], ARRANGEMENT.plazaRadius) });
    }
  }

  // Avenue: a straight road lined on both sides with trees or lamps.
  const roadAt = (c: number, r: number) => roadMap.get(key(c, r));
  const liner = (c: number, r: number) => {
    const b = at.get(key(c, r));
    return b && (b.type === 'tree' || b.type === 'lampPost') ? b : undefined;
  };
  const rows = Math.max(0, ...buildings.map((b) => b.row + defOf(b).h));
  const cols = Math.max(0, ...buildings.map((b) => b.col + defOf(b).w));
  // Lamp posts standing on a road tile, by which edge they're at.
  const lampOn = (c: number, r: number, edge: PlacedBuilding['edge']) => {
    const b = at.get(key(c, r));
    return b && defOf(b).onRoad && b.edge === edge ? b : undefined;
  };
  const runs: { tiles: [number, number][]; across: [number, number] }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!roadAt(c, r) || roadAt(c - 1, r)) continue;
      const tiles: [number, number][] = [];
      for (let x = c; roadAt(x, r); x++) tiles.push([x, r]);
      runs.push({ tiles, across: [0, 1] });
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!roadAt(c, r) || roadAt(c, r - 1)) continue;
      const tiles: [number, number][] = [];
      for (let y = r; roadAt(c, y); y++) tiles.push([c, y]);
      runs.push({ tiles, across: [1, 0] });
    }
  }
  for (const { tiles, across } of runs) {
    if (tiles.length < ARRANGEMENT.avenueLength) continue;
    const [dc, dr] = across;
    // Each side counts trees or lamps just beside the road, or lamps on the road at that edge.
    const [edgeA, edgeB] = dr === 1 ? (['down', 'up'] as const) : (['left', 'right'] as const);
    const sideA = tiles.map(([c, r]) => liner(c - dc, r - dr) ?? lampOn(c, r, edgeA)).filter((b): b is PlacedBuilding => !!b);
    const sideB = tiles.map(([c, r]) => liner(c + dc, r + dr) ?? lampOn(c, r, edgeB)).filter((b): b is PlacedBuilding => !!b);
    if (sideA.length < ARRANGEMENT.avenuePerSide || sideB.length < ARRANGEMENT.avenuePerSide) continue;
    const roads = tiles.map(([c, r]) => roadAt(c, r)!);
    const beside = new Set(tiles.map(([c, r]) => key(c, r)));
    const lined = new Set(homes.filter((h) => tilesBeside(h).some((k) => beside.has(k))));
    found.push({ id: 'avenue', members: [...roads, ...sideA, ...sideB], homes: lined });
  }

  // Promenade: a stretch of road along the water, with a bench and boats or a lamp beside it.
  const waterside = buildings.filter((b) => isRoad(b) && SIDES.some(([dc, dr]) => wet.has(key(b.col + dc, b.row + dr))));
  const walked = new Set<PlacedBuilding>();
  for (const start of waterside) {
    if (walked.has(start)) continue;
    const stretch = [start];
    walked.add(start);
    for (let i = 0; i < stretch.length; i++) {
      for (const other of waterside) {
        if (!walked.has(other) && sideBySide(stretch[i], other)) {
          walked.add(other);
          stretch.push(other);
        }
      }
    }
    if (stretch.length < ARRANGEMENT.promenadeLength) continue;
    const besideIt = (type: string) => buildings.filter((b) => b.type === type && stretch.some((s) => tileGap(b, s) === 0));
    const benches = besideIt('bench');
    const extras = [...besideIt('mooredBoats'), ...besideIt('lampPost')];
    if (benches.length >= 1 && extras.length >= 1) {
      found.push({ id: 'promenade', members: [...stretch, ...benches, ...extras], homes: near(stretch, ARRANGEMENT.promenadeRadius) });
    }
  }

  return found;
}

/** Different arrangement types in town, for tourist appeal. */
export function arrangementTypes(found = findArrangements()): Set<ArrangementId> {
  return new Set(found.map((a) => a.id));
}

export function isDiscovered(id: ArrangementId): boolean {
  return state.arrangementsFound.includes(id);
}

/**
 * Records arrangement types built for the first time and pays their reward.
 * Returns what was just discovered, so the town can celebrate.
 */
export function discoverArrangements(found = findArrangements()): { arrangement: Arrangement; coins: number }[] {
  const out: { arrangement: Arrangement; coins: number }[] = [];
  for (const def of ARRANGEMENTS) {
    if (isDiscovered(def.id)) continue;
    const arrangement = found.find((a) => a.id === def.id);
    if (!arrangement) continue;
    const coins = ARRANGEMENT_BY_ID[def.id].reward * townLevel();
    state.arrangementsFound.push(def.id);
    state.coins += coins;
    out.push({ arrangement, coins });
  }
  return out;
}
