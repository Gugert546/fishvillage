// Pixel art for the ground: grass, forest, fence, painted tiles (roads, canals, bridges), the
// boardwalk and the pier. Coordinates are art pixels (world px / 2), absolute in the world.

import Phaser from 'phaser';
import { GAME_WIDTH, TOWN_COLS } from '../config';
import { PAL, PX, Pix, pixTexture } from '../pixel';
import { Art, hash } from './kit';

/** Which neighbours are the same kind of tile (true = the strip continues that way). */
export interface Edges {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
}

export const edgeKey = (e: Edges) => `${+e.n}${+e.s}${+e.e}${+e.w}`;

/** Cobbled path with a curb wherever it doesn't continue. */
export function roadTile(a: Art, x: number, y: number, e: Edges): void {
  for (let j = 0; j < 16; j++) {
    const row = Math.floor(j / 3);
    for (let i = 0; i < 16; i++) {
      const joint = j % 3 === 2 || (i + (row % 2) * 2) % 4 === 3;
      const n = hash(i, j, 11);
      a.d(x + i, y + j, joint ? PAL.mist : n < 0.06 ? PAL.white : PAL.cloud);
    }
  }
  if (!e.n) a.hl(x, y, 16, PAL.steel).hl(x, y + 1, 16, PAL.white);
  if (!e.s) a.hl(x, y + 15, 16, PAL.steel).hl(x, y + 14, 16, PAL.mist);
  if (!e.w) a.vl(x, y, 16, PAL.steel).vl(x + 1, y, 16, PAL.white);
  if (!e.e) a.vl(x + 15, y, 16, PAL.steel).vl(x + 14, y, 16, PAL.mist);
}

/** Canal: water when it's joined to the sea, a dry ditch otherwise. Stone walls on open sides. */
export function canalTile(a: Art, x: number, y: number, e: Edges, wet: boolean): void {
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++) {
      const n = hash(i, j, 5);
      if (wet) a.d(x + i, y + j, n < 0.03 ? PAL.cyan : PAL.sky);
      else a.d(x + i, y + j, n < 0.12 ? PAL.clay : n > 0.93 ? PAL.bark : PAL.brown);
    }
  }
  if (wet) a.hl(x + 3, y + 5, 3, PAL.cyan).hl(x + 9, y + 11, 3, PAL.cyan).d(x + 12, y + 4, PAL.white);
  if (!e.n) a.hl(x, y, 16, PAL.cloud).hl(x, y + 1, 16, PAL.mist).hl(x, y + 2, 16, wet ? PAL.ocean : PAL.bark);
  if (!e.s) a.hl(x, y + 15, 16, PAL.cloud).hl(x, y + 14, 16, PAL.white);
  if (!e.w) a.vl(x, y, 16, PAL.cloud).vl(x + 1, y, 16, PAL.mist);
  if (!e.e) a.vl(x + 15, y, 16, PAL.mist).vl(x + 14, y, 16, PAL.cloud);
}

/** Wooden bridge deck; `sideways` when the canal under it flows left-right (so it's crossed up-down). */
export function bridgeTile(a: Art, x: number, y: number, sideways: boolean): void {
  if (sideways) {
    a.r(x + 1, y, 14, 16, PAL.tan);
    for (let j = 2; j < 16; j += 3) a.hl(x + 1, y + j, 14, PAL.clay);
    a.vl(x, y, 16, PAL.brown).vl(x + 15, y, 16, PAL.brown);
    a.d(x, y, PAL.bark).d(x, y + 15, PAL.bark).d(x + 15, y, PAL.bark).d(x + 15, y + 15, PAL.bark);
  } else {
    a.r(x, y + 1, 16, 14, PAL.tan);
    for (let i = 2; i < 16; i += 3) a.vl(x + i, y + 1, 14, PAL.clay);
    a.hl(x, y, 16, PAL.brown).hl(x, y + 15, 16, PAL.brown);
    a.d(x, y, PAL.bark).d(x + 15, y, PAL.bark).d(x, y + 15, PAL.bark).d(x + 15, y + 15, PAL.bark);
  }
}

/** Cached texture for one painted tile, world-sized (32×32). */
export function tileTexture(
  scene: Phaser.Scene,
  kind: 'road' | 'canal' | 'bridge',
  e: Edges,
  opts: { wet?: boolean; sideways?: boolean } = {},
): string {
  const key = `tile-${kind}-${edgeKey(e)}-${opts.wet ? 'w' : 'd'}-${opts.sideways ? 's' : 'u'}`;
  return pixTexture(scene, key, 0, 0, 32, 32, (p) => {
    const a = new Art(p);
    if (kind === 'road') roadTile(a, 0, 0, e);
    else if (kind === 'canal') canalTile(a, 0, 0, e, !!opts.wet);
    else {
      canalTile(a, 0, 0, { n: true, s: true, e: true, w: true }, !!opts.wet);
      bridgeTile(a, 0, 0, !!opts.sideways);
    }
  }, { pad: 0 }).key;
}

/** Where a canal in the bottom row runs out across the boardwalk into the sea. */
export function canalMouthTexture(scene: Phaser.Scene, shoreH: number): string {
  return pixTexture(scene, 'canal-mouth', 0, 0, 32, shoreH, (p) => {
    const a = new Art(p);
    const h = shoreH / PX;
    a.r(0, 0, 16, h, PAL.sky).vl(0, 0, h, PAL.mist).vl(15, 0, h, PAL.mist);
    // Plank footbridge carrying the boardwalk over it
    a.r(-1, 2, 18, 12, PAL.tan);
    for (let j = 4; j < 14; j += 3) a.hl(-1, 2 + j - 2, 18, PAL.clay);
    a.hl(-1, 1, 18, PAL.brown).hl(-1, 14, 18, PAL.brown);
  }, { pad: 0 }).key;
}

// -------------------------------------------------------------- Ground

/**
 * Grass for the town, the next expansion strip, the forest beyond and the fence, as one image
 * covering x 0..GAME_WIDTH and y top..0 (world px).
 */
export function groundImage(
  scene: Phaser.Scene,
  key: string,
  top: number,
  rows: number,
  stripRows: number,
  gridX: number,
): Phaser.GameObjects.Image {
  const p = new Pix(0, top, GAME_WIDTH, -top, { pad: 0 });
  const a = new Art(p);
  const T = 16;
  const townTop = -rows * T;
  const stripTop = townTop - stripRows * T;
  const y0 = Math.floor(top / PX);
  const W = Math.ceil(GAME_WIDTH / PX);

  for (let y = y0; y < 0; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash(x, y, 1);
      if (y >= townTop) {
        // Town grass: tufts and the odd flower.
        const c = n < 0.018 ? PAL.lime : n < 0.03 ? PAL.forest : n > 0.9993 ? PAL.yellow : n > 0.9986 ? PAL.white : PAL.green;
        a.d(x, y, c);
      } else if (y >= stripTop) {
        // Land you could buy next: wilder, darker grass.
        a.d(x, y, (x + y) % 2 === 0 ? PAL.green : n < 0.5 ? PAL.forest : PAL.green);
      } else {
        a.d(x, y, n < 0.02 ? PAL.green : PAL.forest);
      }
    }
  }
  // Forest: rows of round treetops
  for (let y = stripTop - 4, r = 0; y > y0 - 12; y -= 11, r++) {
    for (let x = r % 2 ? -4 : 3; x < W + 8; x += 14) {
      const jitter = Math.floor(hash(x, y, 2) * 4) - 2;
      a.oval(x - 1, y - 9 + jitter, 14, 12, PAL.pine);
      a.oval(x, y - 9 + jitter, 12, 10, PAL.green);
      a.oval(x + 2, y - 8 + jitter, 5, 4, PAL.lime);
    }
  }
  // Fence along the town's top edge
  const fx = Math.floor(gridX / PX) - 2;
  const fw = TOWN_COLS * T + 4;
  a.hl(fx, townTop - 5, fw, PAL.tan).hl(fx, townTop - 4, fw, PAL.clay);
  a.hl(fx, townTop - 2, fw, PAL.tan).hl(fx, townTop - 1, fw, PAL.clay);
  for (let x = fx; x <= fx + fw; x += 8) a.r(x, townTop - 7, 2, 8, PAL.brown).d(x, townTop - 7, PAL.clay);
  return p.toImage(scene, key, false);
}

/** The boardwalk along the shore, the sea below it and the fishing pier, from y 0 to `bottom`. */
export function shoreImage(
  scene: Phaser.Scene,
  shoreH: number,
  bottom: number,
  dock: { x: number; y: number; w: number; h: number },
): Phaser.GameObjects.Image {
  const p = new Pix(0, 0, GAME_WIDTH, bottom, { pad: 0 });
  const a = new Art(p);
  const W = Math.ceil(GAME_WIDTH / PX);
  const sh = shoreH / PX;
  const H = bottom / PX;
  // Sea
  for (let y = sh; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash(x, y, 9);
      a.d(x, y, n < 0.004 ? PAL.white : PAL.sky);
    }
  }
  for (let k = 0; k < 60; k++) {
    const x = Math.floor(hash(k, 1, 4) * W);
    const y = sh + 6 + Math.floor(hash(k, 2, 4) * (H - sh - 8));
    a.hl(x, y, 3 + (k % 3), PAL.cyan);
  }
  a.r(0, sh, W, 3, PAL.ocean);
  // Boardwalk: boards across, nails, a heavy edge beam and posts in the water
  for (let x = 0, i = 0; x < W; x += 6, i++) {
    a.r(x, 0, 6, sh - 3, i % 2 ? PAL.tan : PAL.clay);
    a.vl(x, 0, sh - 3, PAL.brown);
    a.d(x + 3, 2, PAL.brown).d(x + 3, sh - 5, PAL.brown);
  }
  a.hl(0, 0, W, PAL.bark);
  a.r(0, sh - 3, W, 3, PAL.brown).hl(0, sh - 1, W, PAL.bark);
  for (let x = 6; x < W; x += 22) a.r(x, sh, 3, 6, PAL.bark);
  // Pier out into the water
  const dx = Math.round(dock.x / PX);
  const dw = Math.round(dock.w / PX);
  const dy = Math.round(dock.y / PX);
  const dh = Math.round(dock.h / PX);
  for (let y = dy + 20; y < dy + dh; y += 30) {
    a.r(dx - 2, y, 3, 14, PAL.bark).r(dx + dw - 1, y, 3, 14, PAL.bark);
  }
  for (let y = dy, i = 0; y < dy + dh; y += 4, i++) {
    a.r(dx, y, dw, 4, i % 2 ? PAL.tan : PAL.clay);
    a.hl(dx, y + 3, dw, PAL.brown);
  }
  a.vl(dx, dy, dh, PAL.brown).vl(dx + dw - 1, dy, dh, PAL.brown);
  a.r(dx, dy + dh, dw, 2, PAL.ocean);
  return p.toImage(scene, 'shore', false);
}
