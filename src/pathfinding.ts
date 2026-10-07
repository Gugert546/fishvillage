// Grid paths for villagers. Buildings and decorations block; roads are cheaper than grass, so
// people naturally take the road when there is one. The shore strip below row 0 is walkable.

import { TOWN_COLS } from './config';
import { defOf } from './population';
import { state, type PlacedBuilding } from './state';
import { townRows } from './town';

export interface Tile {
  col: number;
  row: number;
}

const ROAD_COST = 1;
const GRASS_COST = 3;
/** Row of the sandy shore below the grid. */
const SHORE_ROW = -1;

export class WalkGrid {
  readonly cols = TOWN_COLS;
  readonly rows: number;
  private blocked: Uint8Array;
  private road: Uint8Array;

  constructor() {
    // Index 0 is the shore row, so everything is shifted up by one.
    this.rows = townRows() + 1;
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.road = new Uint8Array(this.cols * this.rows);
    for (const b of state.buildings) {
      const { w, h } = defOf(b);
      for (let c = b.col; c < b.col + w; c++) {
        for (let r = b.row; r < b.row + h; r++) {
          const i = this.index(c, r);
          if (i < 0) continue;
          if (b.type === 'road') this.road[i] = 1;
          else if (b.type !== 'bridge') this.blocked[i] = 1;
        }
      }
    }
    // Bridges make the canal under them walkable, and walk like road.
    for (const b of state.buildings) {
      if (b.type !== 'bridge') continue;
      const i = this.index(b.col, b.row);
      if (i < 0) continue;
      this.blocked[i] = 0;
      this.road[i] = 1;
    }
  }

  private index(col: number, row: number): number {
    const r = row - SHORE_ROW;
    if (col < 0 || col >= this.cols || r < 0 || r >= this.rows) return -1;
    return r * this.cols + col;
  }

  walkable(col: number, row: number): boolean {
    const i = this.index(col, row);
    return i >= 0 && !this.blocked[i];
  }

  isRoad(col: number, row: number): boolean {
    const i = this.index(col, row);
    return i >= 0 && this.road[i] === 1;
  }

  /** The walkable tile just outside a building's door (below its middle), or the nearest open edge tile. */
  doorOf(b: PlacedBuilding): Tile | undefined {
    const { w, h } = defOf(b);
    const doorCol = b.col + Math.floor((w - 1) / 2);
    const candidates: Tile[] = [];
    for (let c = b.col - 1; c <= b.col + w; c++) {
      candidates.push({ col: c, row: b.row - 1 }, { col: c, row: b.row + h });
    }
    for (let r = b.row; r < b.row + h; r++) {
      candidates.push({ col: b.col - 1, row: r }, { col: b.col + w, row: r });
    }
    // Prefer the front, close to the door.
    candidates.sort(
      (a, z) =>
        Number(a.row !== b.row - 1) - Number(z.row !== b.row - 1) ||
        Math.abs(a.col - doorCol) - Math.abs(z.col - doorCol),
    );
    return candidates.find((t) => this.walkable(t.col, t.row));
  }

  /** Cheapest path (inclusive of both ends), or undefined if unreachable. Dial's algorithm. */
  findPath(from: Tile, to: Tile): Tile[] | undefined {
    const start = this.index(from.col, from.row);
    const goal = this.index(to.col, to.row);
    if (start < 0 || goal < 0 || this.blocked[start] || this.blocked[goal]) return undefined;

    const n = this.cols * this.rows;
    const dist = new Int32Array(n).fill(-1);
    const prev = new Int32Array(n).fill(-1);
    const buckets: number[][] = [[start]];
    dist[start] = 0;

    for (let d = 0; d < buckets.length; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (const i of bucket) {
        if (dist[i] !== d) continue; // stale entry
        if (i === goal) return this.unwind(prev, goal);
        const col = i % this.cols;
        const neighbours = [
          col > 0 ? i - 1 : -1,
          col < this.cols - 1 ? i + 1 : -1,
          i >= this.cols ? i - this.cols : -1,
          i + this.cols < n ? i + this.cols : -1,
        ];
        for (const j of neighbours) {
          if (j < 0 || this.blocked[j]) continue;
          const nd = d + (this.road[j] ? ROAD_COST : GRASS_COST);
          if (dist[j] !== -1 && dist[j] <= nd) continue;
          dist[j] = nd;
          prev[j] = i;
          (buckets[nd] ??= []).push(j);
        }
      }
    }
    return undefined;
  }

  private unwind(prev: Int32Array, goal: number): Tile[] {
    const path: Tile[] = [];
    for (let i = goal; i !== -1; i = prev[i]) {
      path.push({ col: i % this.cols, row: Math.floor(i / this.cols) + SHORE_ROW });
    }
    return path.reverse();
  }

  /** A random walkable tile, for strolls. */
  randomWalkable(): Tile | undefined {
    for (let tries = 0; tries < 40; tries++) {
      const col = Math.floor(Math.random() * this.cols);
      const row = Math.floor(Math.random() * this.rows) + SHORE_ROW;
      if (this.walkable(col, row)) return { col, row };
    }
    return undefined;
  }
}
