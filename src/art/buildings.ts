// Pixel art for every building, in art pixels (16 per tile) from the footprint's top-left.
// Roofs, chimneys and flags may poke a few pixels above the footprint.

import Phaser from 'phaser';
import { TILE, type BuildingDef, type BuildingId } from '../config';
import { PAL, pixTexture } from '../pixel';
import { Art, ROOF, WALL, hash, type Tone } from './kit';

/** How many looks a building has; picked per placed building so rows of homes differ. */
const VARIANTS: Partial<Record<BuildingId, number>> = { cottage: 4, apartment: 3 };

export function variantCount(id: BuildingId): number {
  return VARIANTS[id] ?? 1;
}

/** Chimney tops in world px from the footprint's top-left, for smoke. */
export const CHIMNEYS: Partial<Record<BuildingId, { x: number; y: number }>> = {
  cottage: { x: 45, y: 4 },
  apartment: { x: 113, y: 8 },
  playerHouse: { x: 111, y: 20 },
  bathhouse: { x: 47, y: 8 },
};

/** Where the lighthouse lamp is, in world px, for its beam. */
export const LIGHTHOUSE_LAMP = { x: 32, y: 18 };

/** Texture for a building (cached), and where its image goes relative to the footprint. */
export function buildingTexture(scene: Phaser.Scene, def: BuildingDef, variant = 0): { key: string; x: number; y: number } {
  const v = variant % variantCount(def.id);
  const pw = def.w * TILE;
  const ph = def.h * TILE;
  return pixTexture(scene, `bld-${def.id}-${v}`, -6, -20, pw + 12, ph + 26, (p) => {
    const a = new Art(p);
    drawArt(a, def.id, def.w * 16, def.h * 16, v);
    a.outline();
  });
}

function drawArt(a: Art, id: BuildingId, W: number, H: number, v: number): void {
  const art = ART[id];
  if (art) art(a, W, H, v);
  else genericArt(a, W, H);
}

/** Anything without its own drawing: a plain house of the right size. */
function genericArt(a: Art, W: number, H: number): void {
  a.shadow(2, H - 3, W - 4);
  a.roof(1, 1, W - 2, Math.round(H * 0.35), ROOF.slate, 2);
  const top = Math.round(H * 0.35) + 1;
  a.wall(3, top, W - 6, H - top - 2, WALL.sand);
  a.win(6, top + 3, 5, 5);
  a.door(Math.round(W / 2) - 3, H - 11, 6, 9, PAL.brown);
  a.footing(2, H - 2, W - 4, 2);
}

const pick = <T>(list: T[], v: number): T => list[v % list.length];

const ART: Partial<Record<BuildingId, (a: Art, W: number, H: number, v: number) => void>> = {
  cottage(a, _W, _H, v) {
    const wall = pick<Tone>([WALL.amber, WALL.red, WALL.sand, WALL.blue], v);
    a.shadow(3, 29, 28);
    a.chimney(21, 2, 8);
    a.gable(2, 1, 28, 13, wall, ROOF.slate, v === 1 ? PAL.white : undefined);
    a.wall(4, 14, 24, 14, wall);
    a.win(14, 7, 4, 5);
    a.win(6, 17, 5, 6);
    a.win(21, 17, 5, 6);
    a.door(13, 19, 6, 9, pick([PAL.green, PAL.ocean, PAL.crimson, PAL.amber], v));
    a.footing(3, 28, 26, 2);
  },

  apartment(a, _W, _H, v) {
    const [left, right] = pick<[Tone, Tone]>([[WALL.red, WALL.amber], [WALL.orange, WALL.brown], [WALL.sand, WALL.red]], v);
    a.shadow(3, 61, 60);
    a.chimney(55, 4, 8);
    const house = (x: number, top: number, wall: Tone, trim: number | undefined, style: 'plank' | 'brick') => {
      a.gable(x, top, 30, 16, wall, ROOF.slate, trim);
      a.wall(x + 2, top + 16, 26, 59 - top - 16, wall, style);
      a.roundWin(x + 15, top + 9, 2);
      for (const y of [22, 34]) {
        a.win(x + 5, y, 6, 8);
        a.win(x + 19, y, 6, 8);
      }
      a.win(x + 4, 47, 5, 7);
      a.win(x + 21, 47, 5, 7);
      a.door(x + 12, 49, 6, 10, PAL.forest);
    };
    house(1, 2, left, PAL.white, 'plank');
    house(33, 6, right, undefined, 'brick');
    a.footing(1, 59, 62, 3);
  },

  playerHouse(a) {
    a.shadow(3, 61, 60);
    // Pennant on the ridge
    a.vl(32, -8, 10, PAL.bark);
    a.r(33, -8, 6, 1, PAL.yellow).r(33, -7, 5, 1, PAL.amber).r(33, -6, 3, 1, PAL.amber).d(33, -5, PAL.orange);
    a.chimney(54, 10, 10);
    a.roof(1, 18, 62, 9, ROOF.slate, 2);
    a.wall(3, 27, 58, 32, WALL.amber);
    a.gable(12, 2, 40, 25, WALL.red, ROOF.slate, PAL.white);
    a.wall(14, 27, 36, 32, WALL.red, 'brick');
    a.vl(14, 27, 32, PAL.white).vl(49, 27, 32, PAL.white);
    a.roundWin(32, 15, 3);
    a.win(19, 31, 6, 8);
    a.win(39, 31, 6, 8);
    // Little roof over the front door
    a.r(26, 41, 12, 2, PAL.slate).hl(26, 41, 12, PAL.steel);
    a.door(28, 45, 8, 13, PAL.ocean);
    for (const [x, y] of [[5, 31], [52, 31], [5, 45], [52, 45]]) {
      a.r(x - 1, y, 1, 8, PAL.ocean).r(x + 6, y, 1, 8, PAL.ocean);
      a.win(x, y, 6, 8);
    }
    // Window boxes with flowers
    for (const x of [19, 39]) {
      a.r(x - 1, 40, 8, 1, PAL.brown);
      for (let i = 0; i < 6; i += 2) a.d(x + i, 39, pick([PAL.pink, PAL.yellow, PAL.white], i / 2));
    }
    a.footing(2, 59, 60, 3);
  },

  fishStand(a) {
    a.shadow(2, 29, 28);
    a.wall(3, 9, 26, 13, WALL.brown);
    a.r(2, 9, 2, 20, PAL.bark).r(28, 9, 2, 20, PAL.bark);
    a.sign(7, 0, 18, 7, PAL.sand, PAL.brown).fish(13, 2, PAL.sky);
    a.awning(1, 7, 30, PAL.red, PAL.white, 4);
    // Counter with fish laid out on ice
    a.r(2, 21, 28, 8, PAL.tan);
    for (let x = 5; x < 29; x += 4) a.vl(x, 22, 7, PAL.clay);
    a.hl(2, 21, 28, PAL.clay);
    a.r(3, 19, 26, 2, PAL.cloud).hl(3, 19, 26, PAL.white);
    a.fish(4, 17, PAL.sky).fish(12, 17, PAL.salmon).fish(20, 17, PAL.mist);
  },

  baitShop(a) {
    a.shadow(2, 29, 28);
    a.r(2, 3, 28, 3, PAL.forest).hl(2, 3, 28, PAL.green).hl(1, 5, 30, PAL.pine);
    a.wall(3, 6, 26, 22, WALL.green);
    a.sign(6, 8, 20, 6, PAL.sand, PAL.bark);
    // A wriggly worm on the sign
    for (const [x, y] of [[9, 11], [10, 10], [11, 10], [12, 11], [13, 12], [14, 12], [15, 11], [16, 10], [17, 10], [18, 11], [19, 12], [20, 12], [21, 11], [22, 11]]) {
      a.d(x, y, PAL.salmon);
    }
    a.d(22, 10, PAL.ink);
    a.win(5, 16, 10, 8);
    a.r(7, 19, 2, 3, PAL.amber).r(10, 20, 2, 2, PAL.lime).r(12, 19, 2, 3, PAL.salmon);
    a.door(19, 17, 6, 11, PAL.amber);
    a.footing(2, 28, 28, 2);
  },

  tackleShop(a) {
    a.shadow(3, 61, 60);
    a.chimney(50, 2, 8);
    a.roof(1, 4, 62, 12, ROOF.slate, 3);
    // Dormer
    a.r(27, 6, 10, 6, PAL.cloud);
    a.gable(26, 0, 12, 6, WALL.white, ROOF.slate);
    a.win(30, 6, 4, 5);
    a.wall(3, 16, 58, 20, WALL.brown, 'brick');
    for (const x of [7, 20, 38, 51]) a.win(x, 20, 6, 9);
    // Sign with a hook between two fish
    a.sign(4, 36, 56, 8, PAL.navy, PAL.amber);
    a.vl(32, 37, 5, PAL.cloud).hl(29, 41, 3, PAL.cloud).d(29, 40, PAL.cloud).d(30, 39, PAL.cloud).hl(31, 37, 3, PAL.cloud);
    a.fish(17, 38, PAL.amber).fish(40, 38, PAL.amber);
    a.awning(2, 44, 60, PAL.ocean, PAL.white, 4);
    a.r(3, 48, 58, 11, PAL.navy);
    a.win(6, 50, 18, 8);
    a.win(40, 50, 18, 8);
    a.vl(9, 51, 6, PAL.amber).vl(12, 51, 6, PAL.clay).vl(19, 51, 6, PAL.amber).r(45, 54, 4, 3, PAL.red).r(51, 55, 3, 2, PAL.lime);
    a.door(28, 49, 8, 10, PAL.red);
    a.footing(2, 59, 60, 3);
  },

  filletHouse(a) {
    a.shadow(3, 29, 60);
    a.roof(1, 1, 62, 11, ROOF.red, 2);
    a.wall(3, 12, 58, 16, WALL.sand, 'plain');
    // Half-timbering
    for (const x of [3, 18, 45, 60]) a.vl(x, 12, 16, PAL.brown);
    a.hl(3, 12, 58, PAL.brown).hl(3, 20, 58, PAL.brown);
    for (let k = 0; k < 7; k++) {
      a.d(19 + k, 13 + k, PAL.brown);
      a.d(44 - k, 13 + k, PAL.brown);
    }
    a.win(7, 14, 6, 5).win(51, 14, 6, 5);
    // Sign: a salmon and a knife
    a.sign(23, 13, 18, 7, PAL.white, PAL.bark);
    a.r(26, 15, 7, 3, PAL.salmon).d(25, 15, PAL.salmon).d(25, 17, PAL.salmon).d(31, 15, PAL.ink);
    a.hl(34, 16, 3, PAL.cloud).hl(37, 16, 2, PAL.brown);
    a.door(26, 22, 12, 6, PAL.rust);
    a.win(8, 22, 6, 5).win(50, 22, 6, 5);
    a.footing(2, 28, 60, 2);
  },

  warehouse(a) {
    a.shadow(3, 29, 60);
    a.roof(1, 1, 62, 10, ROOF.slate, 2);
    a.wall(3, 11, 58, 17, WALL.rust);
    a.r(28, 12, 8, 4, PAL.brown).hl(27, 12, 10, PAL.bark);
    a.r(22, 16, 20, 1, PAL.bark);
    a.r(23, 17, 18, 11, PAL.brown);
    for (let k = 0; k < 11; k++) {
      a.d(23 + Math.round((k * 17) / 10), 17 + k, PAL.bark);
      a.d(40 - Math.round((k * 17) / 10), 17 + k, PAL.bark);
    }
    a.vl(32, 17, 11, PAL.bark);
    a.crate(5, 22, 6).crate(11, 22, 6).crate(8, 16, 6);
    a.barrel(47, 23).barrel(52, 23);
    a.footing(2, 28, 60, 2);
  },

  tavern(a) {
    a.shadow(3, 29, 60);
    a.gable(0, 0, 32, 13, WALL.orange, ROOF.slate);
    a.wall(2, 13, 28, 15, WALL.orange);
    a.gable(32, 2, 32, 12, WALL.brown, ROOF.slate);
    a.wall(34, 14, 28, 14, WALL.brown, 'brick');
    a.win(14, 6, 4, 5, PAL.amber);
    a.roundWin(48, 8, 2, PAL.amber);
    a.win(5, 16, 6, 6, PAL.amber);
    a.door(19, 18, 6, 10, PAL.bark);
    a.win(36, 18, 6, 6, PAL.amber).win(54, 18, 6, 6, PAL.amber);
    // Hanging sign with a mug of ale
    a.hl(43, 14, 9, PAL.bark);
    a.sign(44, 15, 7, 6, PAL.sand, PAL.bark);
    a.r(46, 17, 3, 3, PAL.amber).d(49, 18, PAL.amber).hl(46, 16, 3, PAL.white);
    a.footing(1, 28, 62, 2);
  },

  netMaker(a) {
    a.shadow(3, 29, 60);
    a.roof(1, 1, 62, 10, ROOF.slate, 2);
    a.wall(3, 11, 58, 17, WALL.ocean);
    // A net drying on the wall, with floats
    a.hl(5, 13, 23, PAL.tan);
    for (let y = 14; y < 26; y++) for (let x = 6; x < 27; x++) if ((x + y) % 3 === 0 || (x - y + 30) % 3 === 0) a.d(x, y, PAL.sand);
    a.d(9, 14, PAL.red).d(15, 14, PAL.white).d(21, 14, PAL.red);
    a.win(32, 14, 6, 6);
    a.door(44, 17, 7, 11, PAL.amber);
    a.oval(54, 14, 4, 6, PAL.red).hl(54, 16, 4, PAL.white);
    a.oval(55, 21, 4, 5, PAL.white).hl(55, 23, 4, PAL.red);
    a.footing(2, 28, 60, 2);
  },

  lighthouse(a) {
    towerArt(a, 16, 16, 56, 7, 11, PAL.red, PAL.crimson);
    // Rocks at the foot
    a.oval(2, 54, 28, 9, PAL.mist).oval(3, 53, 10, 6, PAL.cloud).oval(19, 55, 9, 5, PAL.cloud);
    a.d(8, 58, PAL.steel).d(20, 59, PAL.steel).d(14, 60, PAL.steel);
    a.r(14, 47, 4, 8, PAL.brown).hl(15, 46, 2, PAL.brown);
    lampRoom(a, 16, 6, 12, PAL.red);
  },

  fishermansHut(a) {
    a.shadow(2, 29, 28);
    a.gable(3, 3, 26, 11, WALL.clay, ROOF.brown);
    a.wall(5, 14, 22, 14, WALL.clay);
    a.win(14, 8, 4, 4);
    a.win(8, 17, 5, 5);
    a.door(17, 18, 6, 10, PAL.slate);
    a.barrel(1, 23);
    for (let k = 0; k < 22; k++) a.d(26 + Math.round((k * 4) / 21), 27 - k, PAL.bark);
    a.footing(4, 28, 24, 2);
  },

  seafoodRestaurant(a) {
    a.shadow(3, 29, 60);
    a.roof(1, 1, 62, 9, ROOF.slate, 2);
    a.wall(3, 10, 58, 18, WALL.white, 'plain');
    for (let x = 4; x < 61; x += 3) a.d(x, 11 + (x % 2), PAL.yellow);
    a.sign(24, 12, 16, 6, PAL.navy, PAL.amber);
    a.oval(27, 14, 10, 3, PAL.white);
    a.fish(29, 13, PAL.salmon);
    a.awning(3, 18, 58, PAL.navy, PAL.white, 3);
    a.win(6, 22, 10, 6, PAL.amber).win(48, 22, 10, 6, PAL.amber);
    a.door(29, 22, 6, 6, PAL.crimson);
    a.footing(2, 28, 60, 2);
  },

  fishMarket(a) {
    a.shadow(3, 61, 60);
    a.gable(2, 0, 60, 20, WALL.amber, ROOF.slate, PAL.white);
    a.wall(4, 20, 56, 39, WALL.amber);
    a.roundWin(32, 7, 2);
    a.sign(21, 12, 22, 7, PAL.sand, PAL.brown);
    a.fish(24, 14, PAL.sky).fish(34, 14, PAL.salmon);
    for (const x of [8, 26, 44]) {
      a.r(x, 28, 12, 13, PAL.bark).hl(x + 1, 27, 10, PAL.bark).hl(x + 2, 26, 8, PAL.bark);
      a.hl(x + 2, 25, 8, PAL.white);
    }
    a.awning(3, 38, 58, PAL.red, PAL.white, 4);
    for (let i = 0; i < 4; i++) {
      const x = 6 + i * 14;
      a.r(x, 49, 12, 8, PAL.tan).hl(x, 49, 12, PAL.clay).vl(x + 4, 50, 7, PAL.clay).vl(x + 8, 50, 7, PAL.clay);
      a.r(x, 47, 12, 2, PAL.cloud);
      a.fish(x, 45, pick([PAL.sky, PAL.salmon, PAL.mist, PAL.amber], i)).fish(x + 6, 46, pick([PAL.mist, PAL.sky, PAL.salmon, PAL.cloud], i));
    }
    a.footing(3, 59, 58, 3);
  },

  waterMill(a) {
    a.shadow(2, 29, 28);
    // Mill race under the wheel
    a.r(0, 25, 12, 5, PAL.sky).hl(0, 25, 12, PAL.cyan).d(3, 27, PAL.white).d(8, 28, PAL.white);
    a.gable(10, 2, 22, 11, WALL.clay, ROOF.slate);
    a.wall(12, 13, 18, 8, WALL.clay);
    a.wall(12, 21, 18, 7, WALL.stone, 'brick');
    a.win(15, 15, 4, 4);
    a.door(23, 20, 5, 8, PAL.brown);
    a.footing(11, 28, 20, 2);
  },

  boatyard(a) {
    a.shadow(3, 61, 60);
    a.roof(1, 2, 62, 14, ROOF.brown, 3);
    a.wall(3, 16, 58, 26, WALL.brown);
    a.r(14, 20, 36, 22, PAL.bark);
    a.hl(13, 19, 38, PAL.tan).vl(13, 19, 23, PAL.tan).vl(50, 19, 23, PAL.tan);
    a.d(22, 24, PAL.amber).d(41, 24, PAL.amber).hl(26, 23, 12, PAL.clay);
    // Slipway with a half-built hull
    a.r(10, 42, 44, 18, PAL.tan);
    for (let j = 2; j < 18; j += 3) a.hl(10, 42 + j, 44, PAL.clay);
    for (let i = 16; i < 50; i += 5) a.vl(i, 39, 6, PAL.tan);
    for (let j = 0; j < 10; j++) {
      const inset = Math.round((j * j) / 9);
      a.r(12 + inset, 44 + j, 40 - inset * 2, 1, j % 3 === 0 ? PAL.rust : PAL.copper);
    }
    a.hl(12, 44, 40, PAL.brown);
    a.crate(55, 52, 6);
    a.footing(2, 60, 60, 2);
  },

  bathhouse(a) {
    a.shadow(3, 61, 28);
    a.chimney(22, 4, 10);
    a.gable(1, 4, 30, 14, WALL.blue, ROOF.slate, PAL.white);
    a.wall(3, 18, 26, 41, WALL.blue);
    a.roundWin(16, 12, 2);
    for (const y of [22, 34]) a.win(6, y, 6, 7, PAL.cyan).win(20, y, 6, 7, PAL.cyan);
    a.sign(8, 44, 16, 5, PAL.white, PAL.ocean);
    for (let x = 10; x < 22; x++) a.d(x, 46 + (x % 3 === 0 ? -1 : 0), PAL.ocean);
    a.door(13, 51, 6, 8, PAL.sand);
    a.footing(2, 59, 28, 3);
  },

  cannery(a) {
    a.shadow(3, 61, 60);
    // Tall chimney
    a.wall(50, -6, 6, 32, WALL.grey, 'brick');
    a.r(49, -7, 8, 2, PAL.slate).hl(50, -1, 6, PAL.red);
    // Saw-tooth roof with north lights
    for (let t = 0; t < 3; t++) {
      const x0 = 2 + t * 16;
      for (let k = 0; k < 10; k++) {
        const w = Math.round(((k + 1) * 16) / 10);
        a.r(x0, 4 + k, w, 1, k % 2 ? PAL.navy : PAL.slate);
      }
      a.vl(x0, 4, 10, PAL.cyan).vl(x0 + 1, 5, 9, PAL.sky);
    }
    a.hl(2, 13, 48, PAL.ink);
    a.wall(3, 14, 47, 45, WALL.rust, 'brick');
    a.wall(49, 24, 12, 35, WALL.rust, 'brick');
    for (const x of [7, 17, 27, 37]) a.win(x, 18, 6, 8).win(x, 29, 6, 8);
    a.sign(12, 40, 28, 6, PAL.navy, PAL.amber);
    a.r(24, 41, 4, 4, PAL.cloud).hl(24, 42, 4, PAL.red);
    a.r(5, 54, 40, 2, PAL.slate);
    for (let i = 0; i < 7; i++) a.r(7 + i * 5, 50, 3, 4, PAL.cloud).hl(7 + i * 5, 52, 3, PAL.red);
    a.door(52, 46, 7, 12, PAL.slate);
    a.footing(2, 59, 60, 3);
  },

  exportDocks(a) {
    a.shadow(3, 61, 60);
    // Crane
    a.r(56, 4, 3, 43, PAL.amber);
    for (let y = 6; y < 46; y += 4) a.d(57, y, PAL.orange);
    a.r(30, 2, 32, 2, PAL.amber).r(59, 0, 4, 4, PAL.slate);
    a.vl(34, 4, 24, PAL.ink).hl(33, 28, 3, PAL.steel);
    // Office
    a.gable(2, 14, 22, 10, WALL.white, ROOF.slate);
    a.wall(4, 24, 18, 35, WALL.white, 'plain');
    a.win(8, 28, 6, 6).win(8, 38, 6, 6);
    a.door(9, 49, 6, 10, PAL.ocean);
    // Shipping containers
    const box = (x: number, y: number, w: number, c: Tone) => {
      a.r(x, y, w, 11, c.base);
      for (let i = 2; i < w - 1; i += 2) a.vl(x + i, y + 1, 9, c.dark);
      a.hl(x, y, w, c.light);
    };
    box(26, 48, 17, WALL.red);
    box(43, 48, 18, WALL.ocean);
    box(30, 36, 17, WALL.amber);
    a.r(2, 59, 60, 3, PAL.tan).hl(2, 61, 60, PAL.clay);
  },

  icehouse(a) {
    a.shadow(2, 29, 28);
    a.gable(2, 3, 28, 11, WALL.white, ROOF.snow);
    a.wall(4, 14, 24, 14, WALL.white, 'brick');
    for (let x = 5; x < 27; x += 3) a.vl(x, 14, x % 2 ? 2 : 3, PAL.cyan);
    a.door(12, 17, 7, 11, PAL.sky);
    a.d(13, 19, PAL.white).d(17, 24, PAL.white);
    a.r(22, 23, 5, 5, PAL.cyan).hl(22, 23, 5, PAL.white);
    a.r(23, 19, 4, 4, PAL.cyan).hl(23, 19, 4, PAL.white);
    a.footing(3, 28, 26, 2);
  },

  aquarium(a) {
    a.shadow(3, 29, 60);
    // Glass dome
    a.oval(24, -5, 16, 12, PAL.cyan);
    a.vl(31, -5, 7, PAL.white).hl(25, 0, 14, PAL.white);
    a.roof(1, 1, 62, 8, ROOF.green, 2);
    a.wall(3, 9, 58, 19, WALL.white, 'plain');
    for (const x of [3, 27, 35, 59]) a.r(x, 9, 2, 19, PAL.white).vl(x + 1, 9, 19, PAL.cloud);
    const tank = (x: number, w: number) => {
      a.r(x - 1, 11, w + 2, 15, PAL.navy);
      a.r(x, 12, w, 13, PAL.sky);
      a.r(x, 19, w, 6, PAL.ocean);
      for (let i = x + 1; i < x + w; i += 5) a.vl(i, 21, 4, PAL.green);
      a.d(x + 2, 13, PAL.white).d(x + w - 4, 15, PAL.white);
    };
    tank(6, 20);
    tank(38, 20);
    a.fish(8, 15, PAL.orange).fish(17, 19, PAL.yellow).fish(40, 14, PAL.salmon).fish(49, 18, PAL.amber);
    a.door(29, 18, 6, 10, PAL.navy);
    a.footing(2, 28, 60, 2);
  },
};

/** A tapering striped tower (lighthouses), from y0 to y1, centred on cx. */
function towerArt(a: Art, cx: number, y0: number, y1: number, topHalf: number, bottomHalf: number, stripe: number, stripeDark: number): void {
  for (let j = y0; j < y1; j++) {
    const t = (j - y0) / (y1 - y0);
    const half = Math.round(topHalf + t * (bottomHalf - topHalf));
    const band = Math.floor((j - y0) / 8) % 2 === 0;
    a.r(cx - half, j, half * 2, 1, band ? PAL.white : stripe);
    a.d(cx - half, j, band ? PAL.white : PAL.salmon);
    a.d(cx + half - 1, j, band ? PAL.cloud : stripeDark);
  }
  a.r(cx - 1, y0 + 12, 2, 3, PAL.navy).r(cx - 1, y0 + 26, 2, 3, PAL.navy);
}

/** Gallery, lamp room and cap on top of a tower; the lamp centre is at (cx, top + 3). */
function lampRoom(a: Art, cx: number, top: number, w: number, cap: number): void {
  a.r(cx - w / 2 - 3, top + 8, w + 6, 2, PAL.navy);
  for (let i = cx - w / 2 - 3; i < cx + w / 2 + 3; i += 2) a.vl(i, top + 6, 2, PAL.slate);
  a.hl(cx - w / 2 - 3, top + 6, w + 6, PAL.slate);
  a.r(cx - w / 2, top, w, 6, PAL.yellow);
  a.vl(cx - 3, top, 6, PAL.navy).vl(cx + 2, top, 6, PAL.navy).d(cx - w / 2 + 1, top + 1, PAL.white);
  a.tri(cx - w / 2 - 1, top - 6, w + 2, 6, cap);
  a.vl(cx - 1, top - 8, 2, PAL.bark);
}

// ------------------------------------------------------- Moving parts

/** The water mill's wheel, centred on (0, 0). */
export function millWheelTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'mill-wheel', -16, -16, 32, 32, (p) => {
    p.lineStyle(4, PAL.brown).strokeCircle(0, 0, 12);
    p.lineStyle(2, PAL.clay);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      p.lineBetween(0, 0, Math.cos(ang) * 12, Math.sin(ang) * 12);
      p.fillStyle(PAL.tan).fillRect(Math.cos(ang) * 13 - 3, Math.sin(ang) * 13 - 3, 6, 6);
    }
    p.fillStyle(PAL.bark).fillRect(-2, -2, 4, 4);
    p.outline();
  }).key;
}

/** Bunting and stalls laid over the town square during a festival. */
export function festivalTexture(scene: Phaser.Scene): { key: string; x: number; y: number } {
  return pixTexture(scene, 'square-festival', 0, 0, TILE * 4, TILE * 4, (p) => {
    const a = new Art(p);
    const colors = [PAL.red, PAL.yellow, PAL.green, PAL.sky, PAL.orange];
    for (const y of [2, 61]) {
      a.hl(1, y, 62, PAL.bark);
      for (let x = 2, i = 0; x < 62; x += 5, i++) a.tri(x, y + 1, 4, 3, colors[i % colors.length]);
    }
    for (const [x, c] of [[8, PAL.red], [44, PAL.green]] as [number, number][]) {
      a.r(x, 34, 12, 6, PAL.clay).hl(x, 34, 12, PAL.brown);
      a.awning(x - 1, 29, 14, c, PAL.white, 3);
      a.d(x + 3, 33, PAL.amber).d(x + 7, 33, PAL.yellow);
    }
  });
}

/** Paved square with a bandstand in the middle and benches in the corners. */
export function squareTexture(scene: Phaser.Scene): { key: string; x: number; y: number } {
  return pixTexture(scene, 'square', 0, 0, TILE * 4, TILE * 4, (p) => {
    const a = new Art(p);
    a.r(1, 1, 62, 62, PAL.cloud);
    for (let j = 1; j < 63; j++) {
      for (let i = 1; i < 63; i++) {
        if (j % 4 === 0 || (i + (Math.floor(j / 4) % 2) * 3) % 6 === 0) a.d(i, j, PAL.mist);
        else if (hash(i, j, 3) < 0.04) a.d(i, j, PAL.white);
      }
    }
    // Bandstand
    a.oval(17, 30, 32, 14, PAL.ink, 0.25);
    a.oval(16, 28, 32, 12, PAL.white).oval(17, 29, 30, 10, PAL.cloud);
    for (const x of [19, 31, 44]) a.r(x, 18, 2, 14, PAL.white).vl(x + 1, 18, 14, PAL.cloud);
    a.tri(14, 8, 36, 11, PAL.crimson);
    a.tri(16, 9, 32, 10, PAL.red);
    a.hl(14, 18, 36, PAL.crimson).d(32, 7, PAL.amber);
    for (const [x, y] of [[4, 5], [50, 5], [4, 56], [50, 56]]) {
      a.r(x, y, 10, 2, PAL.clay).r(x, y + 2, 1, 2, PAL.bark).r(x + 9, y + 2, 1, 2, PAL.bark);
    }
    p.outline();
  }, { pad: 0 });
}

