// Pixel art for decorations, landmarks and painted tiles' menu icons, in art pixels from the
// footprint's top-left (16 per tile).

import Phaser from 'phaser';
import { TILE, type BuildingDef, type BuildingId } from '../config';
import { PAL, pixTexture } from '../pixel';
import { Art, WALL, hash } from './kit';
import { roadTile, canalTile, bridgeTile } from './ground';

/** Where the lamp post's lantern glows, in world px from its top-left. */
export const LAMP_GLOW = { x: TILE / 2, y: 6 };
/** Fountain spout and pool centre, world px. */
export const FOUNTAIN = { spoutX: TILE, spoutY: 12, poolY: 34 };

export function decorTexture(scene: Phaser.Scene, def: BuildingDef): { key: string; x: number; y: number } {
  const pw = def.w * TILE;
  const ph = def.h * TILE;
  return pixTexture(scene, `decor-${def.id}`, -6, -20, pw + 12, ph + 26, (p) => {
    const a = new Art(p);
    DECOR[def.id]?.(a, def.w * 16, def.h * 16);
    a.outline();
  });
}

const DECOR: Partial<Record<BuildingId, (a: Art, W: number, H: number) => void>> = {
  flowerBed(a) {
    a.r(1, 9, 14, 5, PAL.brown).hl(1, 9, 14, PAL.clay).hl(1, 13, 14, PAL.bark);
    const colors = [PAL.red, PAL.yellow, PAL.pink, PAL.white, PAL.salmon];
    for (let i = 0; i < 6; i++) {
      const x = 2 + i * 2 + (i % 2);
      a.vl(x, 6, 3, PAL.green);
      a.d(x, 5 - (i % 2), colors[i % colors.length]);
      a.d(x - 1, 6 - (i % 2), colors[i % colors.length]);
    }
    a.d(4, 8, PAL.lime).d(9, 8, PAL.lime).d(12, 7, PAL.lime);
  },

  tree(a) {
    a.r(3, 13, 12, 2, PAL.ink, 0.28);
    a.r(7, 8, 2, 6, PAL.bark).d(7, 13, PAL.brown);
    a.oval(1, -4, 14, 13, PAL.forest);
    a.oval(2, -4, 11, 10, PAL.green);
    a.oval(3, -3, 6, 5, PAL.lime);
    for (const [x, y] of [[10, 4], [5, 6], [12, 1], [8, -2]]) a.d(x, y, PAL.forest);
    a.d(4, -2, PAL.yellow);
  },

  bench(a) {
    a.r(3, 13, 11, 2, PAL.ink, 0.28);
    a.vl(3, 5, 9, PAL.bark).vl(12, 5, 9, PAL.bark);
    a.r(2, 5, 12, 2, PAL.clay).hl(2, 5, 12, PAL.tan);
    a.r(2, 9, 12, 2, PAL.clay).hl(2, 9, 12, PAL.tan);
  },

  lampPost(a) {
    a.r(5, 13, 6, 2, PAL.slate).hl(5, 13, 6, PAL.steel);
    a.vl(7, 5, 9, PAL.slate).vl(8, 5, 9, PAL.navy);
    a.r(5, 0, 6, 5, PAL.navy);
    a.r(6, 1, 4, 3, PAL.yellow).d(6, 1, PAL.white);
    a.tri(4, -2, 8, 2, PAL.navy);
  },

  palm(a) {
    a.r(4, 13, 10, 2, PAL.ink, 0.28);
    for (let j = 4; j < 14; j++) a.r(7 + Math.round((14 - j) / 5), j, 2, 1, j % 3 === 0 ? PAL.tan : PAL.clay);
    for (let dx = -7; dx <= 7; dx++) {
      const y = 2 + Math.floor((dx * dx) / 10);
      a.d(9 + dx, y, PAL.green);
      if (Math.abs(dx) < 5) a.d(9 + dx, y - 1, PAL.lime);
    }
    for (let dx = -5; dx <= 5; dx++) a.d(9 + dx, 4 + Math.floor((dx * dx) / 6), PAL.forest);
    a.d(8, 4, PAL.brown).d(10, 4, PAL.brown);
  },

  goldenAnchor(a) {
    a.r(3, 13, 10, 2, PAL.mist).hl(3, 13, 10, PAL.cloud);
    a.d(7, 0, PAL.amber).d(8, 0, PAL.amber).d(6, 1, PAL.amber).d(9, 1, PAL.amber).d(7, 2, PAL.amber).d(8, 2, PAL.amber);
    a.vl(7, 3, 9, PAL.amber).vl(8, 3, 9, PAL.yellow);
    a.hl(4, 5, 8, PAL.amber);
    a.hl(4, 12, 8, PAL.amber);
    a.d(3, 11, PAL.amber).d(12, 11, PAL.amber).d(2, 10, PAL.amber).d(13, 10, PAL.amber).d(2, 9, PAL.yellow).d(13, 9, PAL.yellow);
  },

  fountain(a) {
    a.oval(2, 8, 30, 22, PAL.ink, 0.25);
    a.oval(1, 6, 30, 22, PAL.mist);
    a.oval(2, 6, 28, 20, PAL.cloud);
    a.oval(4, 8, 24, 15, PAL.sky);
    a.oval(6, 12, 12, 6, PAL.cyan);
    a.r(14, 6, 4, 10, PAL.cloud).vl(14, 6, 10, PAL.white).vl(17, 6, 10, PAL.mist);
    a.oval(10, 4, 12, 4, PAL.cloud).hl(11, 4, 10, PAL.white);
    a.d(15, 3, PAL.cyan).d(16, 2, PAL.white);
  },

  koiPond(a) {
    a.oval(1, 4, 30, 24, PAL.mist);
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2;
      if (hash(i, 1) < 0.5) a.d(Math.round(16 + Math.cos(ang) * 14), Math.round(16 + Math.sin(ang) * 11), PAL.steel);
    }
    a.oval(3, 6, 26, 20, PAL.ocean);
    a.oval(5, 8, 20, 12, PAL.sky);
    for (const [x, y, c] of [[9, 12, PAL.orange], [17, 19, PAL.white], [12, 18, PAL.red], [20, 13, PAL.orange]] as [number, number, number][]) {
      a.r(x, y, 3, 2, c).d(x - 1, y, c);
    }
    a.oval(21, 8, 6, 4, PAL.green).d(23, 9, PAL.lime).d(24, 9, PAL.salmon);
  },

  statue(a) {
    a.oval(3, 27, 28, 5, PAL.ink, 0.25);
    a.r(6, 22, 20, 8, PAL.cloud).vl(6, 22, 8, PAL.white).vl(25, 22, 8, PAL.mist);
    a.r(4, 20, 24, 2, PAL.white).hl(4, 21, 24, PAL.mist);
    a.r(12, 25, 8, 2, PAL.amber);
    // The founder, in bronze, holding up a big catch
    a.r(13, 13, 2, 7, PAL.brown).r(17, 13, 2, 7, PAL.brown);
    a.r(12, 6, 8, 8, PAL.clay).vl(12, 6, 8, PAL.tan);
    a.oval(13, 0, 6, 6, PAL.clay).d(14, 1, PAL.tan);
    a.vl(20, 1, 6, PAL.clay);
    a.r(18, -3, 9, 3, PAL.tan).d(27, -3, PAL.tan).d(27, -1, PAL.tan).d(19, -3, PAL.brown);
  },

  clockTower(a) {
    a.r(9, 29, 18, 2, PAL.ink, 0.25);
    a.wall(7, 2, 18, 28, WALL.stone, 'brick');
    a.tri(5, -10, 22, 13, PAL.navy);
    a.tri(7, -9, 18, 12, PAL.slate);
    a.d(16, -11, PAL.amber).d(16, -12, PAL.amber);
    a.oval(10, 5, 12, 12, PAL.amber);
    a.oval(11, 6, 10, 10, PAL.white);
    a.vl(16, 7, 4, PAL.ink).hl(16, 11, 3, PAL.ink);
    a.r(13, 22, 6, 8, PAL.brown).hl(14, 21, 4, PAL.brown);
    a.footing(6, 29, 20, 2);
  },

  grandLighthouse(a) {
    a.r(2, 61, 30, 3, PAL.ink, 0.25);
    a.wall(4, 50, 24, 12, WALL.stone, 'brick');
    for (let j = 14; j < 50; j++) {
      const half = Math.round(7 + ((j - 14) / 36) * 3);
      const band = Math.floor((j - 14) / 6) % 2 === 0;
      a.r(16 - half, j, half * 2, 1, band ? PAL.white : PAL.red);
      a.d(16 - half, j, band ? PAL.white : PAL.salmon).d(15 + half, j, band ? PAL.cloud : PAL.crimson);
    }
    a.r(14, 52, 4, 9, PAL.brown);
    a.r(3, 10, 26, 3, PAL.navy);
    for (let i = 3; i < 29; i += 2) a.vl(i, 8, 2, PAL.slate);
    a.hl(3, 8, 26, PAL.slate);
    a.r(9, 1, 14, 7, PAL.yellow).vl(13, 1, 7, PAL.navy).vl(18, 1, 7, PAL.navy).d(10, 2, PAL.white);
    a.tri(7, -6, 18, 7, PAL.red);
    a.vl(15, -9, 3, PAL.amber);
  },

  harborGate(a) {
    a.r(4, 29, 58, 3, PAL.ink, 0.2);
    for (const x of [3, 49]) a.wall(x, 8, 12, 22, WALL.stone, 'brick');
    a.wall(3, 3, 58, 8, WALL.stone, 'brick');
    for (let k = 0; k < 4; k++) a.r(15 + k, 11 + k, 1, 1, PAL.cloud).r(48 - k, 11 + k, 1, 1, PAL.cloud);
    a.r(15, 11, 34, 1, PAL.cloud);
    a.r(22, 4, 20, 5, PAL.amber).hl(22, 4, 20, PAL.yellow).hl(22, 8, 20, PAL.orange);
    a.hl(1, 2, 62, PAL.white);
    for (const x of [8, 55]) {
      a.vl(x, -9, 11, PAL.bark);
      a.r(x + 1, -9, 6, 4, PAL.ocean).hl(x + 1, -8, 6, PAL.sky);
    }
  },
};

/** Stone plinth for a mounted legendary fish (the fish itself is a separate image). */
export function plinthTexture(scene: Phaser.Scene): { key: string; x: number; y: number } {
  return pixTexture(scene, 'plinth', 0, 0, TILE * 2, TILE * 2, (p) => {
    const a = new Art(p);
    a.oval(3, 27, 28, 5, PAL.ink, 0.25);
    a.r(6, 18, 20, 11, PAL.cloud).vl(6, 18, 11, PAL.white).vl(25, 18, 11, PAL.mist);
    a.r(4, 16, 24, 2, PAL.white).hl(4, 17, 24, PAL.mist);
    a.r(11, 22, 10, 3, PAL.amber).hl(11, 22, 10, PAL.yellow);
    a.outline();
  });
}

/** Little jetty for moored boats. */
export function jettyTexture(scene: Phaser.Scene): { key: string; x: number; y: number } {
  return pixTexture(scene, 'jetty', 0, 0, TILE, TILE, (p) => {
    const a = new Art(p);
    a.r(3, 3, 10, 10, PAL.clay);
    for (let y = 4; y < 13; y += 3) a.hl(3, y, 10, PAL.brown);
    a.r(7, 7, 2, 2, PAL.bark);
    a.outline();
  });
}

/** A rowboat, centred on (0, 0). */
export function rowboatTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'rowboat', -12, -6, 24, 12, (p) => {
    p.fillStyle(PAL.brown).fillEllipse(0, 0, 22, 10);
    p.fillStyle(PAL.tan).fillEllipse(0, -1, 16, 6);
    p.fillStyle(PAL.bark).fillRect(-1, -4, 2, 6);
    p.outline();
  }).key;
}

/** A little fishing boat seen from above, bow to the right, centred on (0, 0). */
export function fleetBoatTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'fleet-boat', -14, -8, 28, 16, (p) => {
    p.fillStyle(PAL.red).fillEllipse(0, 0, 26, 12);
    p.fillStyle(PAL.sand).fillEllipse(-1, 0, 18, 7);
    p.fillStyle(PAL.white).fillRect(-7, -3, 8, 6);
    p.fillStyle(PAL.navy).fillRect(-6, -2, 2, 4);
    p.fillStyle(PAL.bark).fillRect(5, -1, 2, 2);
    p.outline();
  }).key;
}

/** Build-menu icon for painted tiles. */
export function tileIconTexture(scene: Phaser.Scene, id: BuildingId): { key: string; x: number; y: number } {
  return pixTexture(scene, `tile-icon-${id}`, 0, 0, TILE, TILE, (p) => {
    const a = new Art(p);
    const edges = { n: false, s: false, e: false, w: false };
    if (id === 'canal') canalTile(a, 0, 0, edges, true);
    else if (id === 'bridge') {
      canalTile(a, 0, 0, edges, true);
      bridgeTile(a, 0, 0, false);
    } else roadTile(a, 0, 0, edges);
    a.outline();
  });
}
