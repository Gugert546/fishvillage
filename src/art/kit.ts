// Building blocks for pixel art, in art-pixel coordinates (1 unit = PX world px) relative to
// the drawing's origin. Styled after a Nordic wharf: steep gables, slate roofs, white-framed
// windows and stone footings.

import { PAL, PX, snap, type Pix } from '../pixel';

/** Three tones of one material: lit edge, face, shadow. */
export interface Tone {
  light: number;
  base: number;
  dark: number;
}

export const WALL = {
  amber: { light: PAL.yellow, base: PAL.amber, dark: PAL.orange },
  orange: { light: PAL.amber, base: PAL.orange, dark: PAL.rust },
  red: { light: PAL.salmon, base: PAL.red, dark: PAL.crimson },
  rust: { light: PAL.copper, base: PAL.rust, dark: PAL.brown },
  brown: { light: PAL.clay, base: PAL.brown, dark: PAL.bark },
  clay: { light: PAL.tan, base: PAL.clay, dark: PAL.brown },
  sand: { light: PAL.white, base: PAL.sand, dark: PAL.tan },
  white: { light: PAL.white, base: PAL.cloud, dark: PAL.mist },
  blue: { light: PAL.cyan, base: PAL.sky, dark: PAL.ocean },
  ocean: { light: PAL.sky, base: PAL.ocean, dark: PAL.navy },
  green: { light: PAL.lime, base: PAL.green, dark: PAL.forest },
  stone: { light: PAL.white, base: PAL.cloud, dark: PAL.mist },
  grey: { light: PAL.cloud, base: PAL.mist, dark: PAL.steel },
  plum: { light: PAL.magenta, base: PAL.plum, dark: PAL.bark },
} satisfies Record<string, Tone>;

export const ROOF = {
  slate: { light: PAL.steel, base: PAL.slate, dark: PAL.navy },
  red: { light: PAL.red, base: PAL.crimson, dark: PAL.bark },
  green: { light: PAL.green, base: PAL.forest, dark: PAL.pine },
  brown: { light: PAL.clay, base: PAL.brown, dark: PAL.bark },
  snow: { light: PAL.white, base: PAL.white, dark: PAL.cloud },
} satisfies Record<string, Tone>;

/** Stable pseudo-random 0..1 per pixel, for speckles that don't flicker between redraws. */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Art {
  constructor(readonly p: Pix) {}

  /** Rectangle in art pixels. */
  r(x: number, y: number, w: number, h: number, c: number, a = 1): this {
    if (w <= 0 || h <= 0) return this;
    this.p.fillStyle(c, a).fillRect(x * PX, y * PX, w * PX, h * PX);
    return this;
  }

  d(x: number, y: number, c: number, a = 1): this {
    // Hot path (ground layers plot every pixel), so skip the rectangle machinery.
    const [i, j] = this.p.artIndex(x, y);
    this.p.plot(i, j, this.p.snaps ? snap(c) : c, a);
    return this;
  }

  hl(x: number, y: number, w: number, c: number): this {
    return this.r(x, y, w, 1, c);
  }

  vl(x: number, y: number, h: number, c: number): this {
    return this.r(x, y, 1, h, c);
  }

  /** Filled ellipse inside a box. */
  oval(x: number, y: number, w: number, h: number, c: number, a = 1): this {
    this.p.fillStyle(c, a).fillEllipse((x + w / 2) * PX, (y + h / 2) * PX, w * PX, h * PX);
    return this;
  }

  /** Stair-stepped triangle with its apex at the top middle of a w×h box. */
  tri(x: number, y: number, w: number, h: number, c: number): this {
    for (let k = 0; k < h; k++) {
      const half = Math.max(1, Math.round(((k + 1) / h) * (w / 2)));
      this.r(x + Math.round(w / 2) - half, y + k, half * 2, 1, c);
    }
    return this;
  }

  /** Soft drop shadow on the ground at the bottom of a footprint. */
  shadow(x: number, y: number, w: number, h = 3): this {
    return this.r(x + 2, y, w, h, PAL.ink, 0.28);
  }

  /** A wall face with planks, bricks or plaster, lit from the left. */
  wall(x: number, y: number, w: number, h: number, t: Tone, style: 'plank' | 'brick' | 'plain' = 'plank'): this {
    this.r(x, y, w, h, t.base);
    if (style === 'plank') {
      for (let i = x + 3; i < x + w - 1; i += 4) this.vl(i, y, h, t.light);
    } else if (style === 'brick') {
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          const n = hash(i, j, 7);
          if (n < 0.1) this.d(i, j, t.dark);
          else if (n > 0.95) this.d(i, j, t.light);
        }
      }
    }
    this.vl(x, y, h, t.light);
    this.vl(x + w - 1, y, h, t.dark);
    this.hl(x, y, w, t.dark); // shade under the eaves
    return this;
  }

  /** Slate rows with scalloped highlights, like the roofs in old harbour towns. */
  tiles(x: number, y: number, w: number, h: number, t: Tone): this {
    this.r(x, y, w, h, t.base);
    for (let j = 0; j < h; j++) {
      if (j % 2 === 1) {
        this.hl(x, y + j, w, t.dark);
        continue;
      }
      const shift = (j / 2) % 2 === 0 ? 0 : 2;
      for (let i = shift; i < w; i += 4) this.d(x + i, y + j, t.light);
    }
    return this;
  }

  /** A roof seen from the front: tiled rows, narrower toward the ridge, dark eave line. */
  roof(x: number, y: number, w: number, h: number, t: Tone, ridge = 1): this {
    for (let j = 0; j < h; j++) {
      const inset = Math.max(0, Math.round(ridge * (1 - j / Math.max(1, h - 1))));
      const xi = x + inset;
      const wi = w - inset * 2;
      if (j % 2 === 1) {
        this.hl(xi, y + j, wi, t.dark);
        continue;
      }
      this.hl(xi, y + j, wi, t.base);
      const shift = (j / 2) % 2 === 0 ? 1 : 3;
      for (let i = shift; i < wi; i += 4) this.d(xi + i, y + j, t.light);
    }
    this.hl(x, y + h - 1, w, PAL.ink);
    return this;
  }

  /**
   * Front-facing gable: roof edge triangle, an optional trim line, and the wall continuing up
   * into the point. Wall below the gable is drawn separately.
   */
  gable(x: number, y: number, w: number, h: number, wall: Tone, roof: Tone, trim?: number): this {
    this.tri(x, y, w, h, roof.dark);
    this.tri(x + 1, y + 1, w - 2, h - 1, roof.base);
    if (trim !== undefined) {
      this.tri(x + 2, y + 2, w - 4, h - 2, trim);
      this.tri(x + 3, y + 3, w - 6, h - 3, wall.base);
    } else {
      this.tri(x + 2, y + 2, w - 4, h - 2, wall.base);
    }
    return this;
  }

  /** Window with a white frame and cross bars; `glass` amber for a warm lit room. */
  win(x: number, y: number, w: number, h: number, glass: number = PAL.navy, frame: number = PAL.white): this {
    this.r(x, y, w, h, frame);
    this.r(x + 1, y + 1, w - 2, h - 2, glass);
    if (h >= 6) this.hl(x + 1, y + Math.floor(h / 2), w - 2, frame);
    if (w >= 6) this.vl(x + Math.floor(w / 2), y + 1, h - 2, frame);
    this.d(x + 1, y + 1, glass === PAL.navy ? PAL.ocean : PAL.yellow);
    this.hl(x, y + h, w, PAL.ink); // sill shadow
    return this;
  }

  /** Small round window, for gables. */
  roundWin(cx: number, cy: number, r: number, glass: number = PAL.navy): this {
    this.oval(cx - r - 1, cy - r - 1, r * 2 + 2, r * 2 + 2, PAL.white);
    this.oval(cx - r, cy - r, r * 2, r * 2, glass);
    this.d(cx - 1, cy - 1, glass === PAL.navy ? PAL.ocean : PAL.yellow);
    return this;
  }

  /** Door in a white frame with a brass knob and a stone step. */
  door(x: number, y: number, w: number, h: number, c: number = PAL.green): this {
    this.r(x - 1, y - 1, w + 2, h + 1, PAL.white);
    this.r(x, y, w, h, c);
    this.vl(x + Math.floor(w / 2), y + 1, h - 2, PAL.ink);
    this.hl(x, y, w, PAL.ink);
    this.d(x + w - 2, y + Math.floor(h / 2) + 1, PAL.amber);
    this.r(x - 1, y + h, w + 2, 1, PAL.mist);
    return this;
  }

  /** Stone footing with mortar joints. */
  footing(x: number, y: number, w: number, h = 2): this {
    this.r(x, y, w, h, PAL.cloud);
    for (let j = 0; j < h; j++) for (let i = (j % 2) * 2; i < w; i += 4) this.d(x + i, y + j, PAL.mist);
    this.hl(x, y + h - 1, w, PAL.mist);
    return this;
  }

  /** Striped awning with a scalloped edge. */
  awning(x: number, y: number, w: number, a: number, b: number, h = 4): this {
    for (let i = 0; i < w; i++) {
      const c = Math.floor(i / 3) % 2 === 0 ? a : b;
      this.vl(x + i, y, h, c);
      if (i % 3 !== 1) this.d(x + i, y + h, c);
    }
    this.hl(x, y, w, PAL.ink);
    return this;
  }

  /** Signboard with a border; draw the picture on it afterwards. */
  sign(x: number, y: number, w: number, h: number, bg: number = PAL.sand, border: number = PAL.brown): this {
    this.r(x, y, w, h, border);
    this.r(x + 1, y + 1, w - 2, h - 2, bg);
    return this;
  }

  /** Brick chimney with a cap. */
  chimney(x: number, y: number, h: number): this {
    this.r(x, y + 1, 3, h, PAL.brown);
    this.vl(x, y + 1, h, PAL.clay);
    this.r(x - 1, y, 5, 1, PAL.bark);
    return this;
  }

  /** A little fish, facing right, about 6×3. */
  fish(x: number, y: number, c: number = PAL.sky): this {
    this.d(x, y, c).d(x, y + 2, c).d(x + 1, y + 1, c);
    this.r(x + 2, y, 3, 3, c);
    this.d(x + 5, y + 1, c);
    this.d(x + 4, y, PAL.ink);
    return this;
  }

  /** Wooden crate. */
  crate(x: number, y: number, s = 5): this {
    this.r(x, y, s, s, PAL.tan);
    this.hl(x, y, s, PAL.clay).hl(x, y + s - 1, s, PAL.clay).vl(x, y, s, PAL.clay).vl(x + s - 1, y, s, PAL.clay);
    for (let k = 1; k < s - 1; k++) this.d(x + k, y + k, PAL.clay);
    return this;
  }

  /** Barrel. */
  barrel(x: number, y: number): this {
    this.r(x, y, 4, 5, PAL.clay);
    this.vl(x, y, 5, PAL.tan);
    this.hl(x, y + 1, 4, PAL.bark).hl(x, y + 3, 4, PAL.bark);
    return this;
  }

  /** Ink outline around everything drawn so far. */
  outline(): this {
    this.p.outline(PAL.ink);
    return this;
  }
}
