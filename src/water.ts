// Canals: water flows in from the sea through connected canal tiles. A canal in the bottom row
// meets the beach, so it's open to the sea; anything joined to it fills up, the rest stays dry.

import { defOf } from './population';
import { state, type PlacedBuilding } from './state';

const key = (col: number, row: number) => `${col},${row}`;

/** Canal tiles that hold water. */
export function wateredTiles(): Set<string> {
  const canals = new Set(state.buildings.filter((b) => b.type === 'canal').map((b) => key(b.col, b.row)));
  const wet = new Set<string>();
  const queue = state.buildings.filter((b) => b.type === 'canal' && b.row === 0).map((b) => [b.col, b.row]);
  for (const [c, r] of queue) wet.add(key(c, r));
  while (queue.length > 0) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(c + dc, r + dr);
      if (canals.has(k) && !wet.has(k)) {
        wet.add(k);
        queue.push([c + dc, r + dr]);
      }
    }
  }
  return wet;
}

/** Whether a building sits right beside water (not diagonally). For waterside buildings. */
export function touchesWater(b: PlacedBuilding, wet = wateredTiles()): boolean {
  const { w, h } = defOf(b);
  for (let c = b.col; c < b.col + w; c++) {
    if (wet.has(key(c, b.row - 1)) || wet.has(key(c, b.row + h))) return true;
  }
  for (let r = b.row; r < b.row + h; r++) {
    if (wet.has(key(b.col - 1, r)) || wet.has(key(b.col + w, r))) return true;
  }
  return false;
}

/** Waterside buildings only work while they're beside water; everything else always works. */
export function isWorking(b: PlacedBuilding, wet = wateredTiles()): boolean {
  return !defOf(b).needsWater || touchesWater(b, wet);
}
