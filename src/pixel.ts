// Pixel-art painter. Everything is drawn on a grid of art pixels that are PX world px wide, in
// the Endesga 32 palette, then outlined in dark ink. It takes world coordinates like Phaser's
// Graphics, so shapes can be described in game units and still come out as crisp pixel art.

import Phaser from 'phaser';

/** World px per art pixel. */
export const PX = 2;

/** Endesga 32 (lospec.com/palette-list/endesga-32), named for how the game uses each colour. */
export const PAL = {
  rust: 0xbe4a2f,
  copper: 0xd77643,
  sand: 0xead4aa,
  tan: 0xe4a672,
  clay: 0xb86f50,
  brown: 0x733e39,
  bark: 0x3e2731,
  crimson: 0xa22633,
  red: 0xe43b44,
  orange: 0xf77622,
  amber: 0xfeae34,
  yellow: 0xfee761,
  lime: 0x63c74d,
  green: 0x3e8948,
  forest: 0x265c42,
  pine: 0x193c3e,
  ocean: 0x124e89,
  sky: 0x0099db,
  cyan: 0x2ce8f5,
  white: 0xffffff,
  cloud: 0xc0cbdc,
  mist: 0x8b9bb4,
  steel: 0x5a6988,
  slate: 0x3a4466,
  navy: 0x262b44,
  ink: 0x181425,
  pink: 0xff0044,
  plum: 0x68386c,
  magenta: 0xb55088,
  salmon: 0xf6757a,
  skin: 0xe8b796,
  skinDark: 0xc28569,
} as const;

const PALETTE: number[] = Object.values(PAL);
const snapCache = new Map<number, number>();

/** The palette colour closest to `c` (weighted RGB distance, which tracks perception well enough). */
export function snap(c: number): number {
  const hit = snapCache.get(c);
  if (hit !== undefined) return hit;
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const pr = (p >> 16) & 0xff;
    const pg = (p >> 8) & 0xff;
    const pb = p & 0xff;
    const rm = (r + pr) / 2;
    const d = (2 + rm / 256) * (r - pr) ** 2 + 4 * (g - pg) ** 2 + (2 + (255 - rm) / 256) * (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  snapCache.set(c, best);
  return best;
}

/** 4×4 ordered-dither thresholds, for two-colour blends. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export interface PixOptions {
  /** Snap colours to the palette (default true). */
  snap?: boolean;
  /** Art pixels of empty margin around the area, room for the outline (default 1). */
  pad?: number;
}

/**
 * A pixel canvas covering a rectangle of the world. Drawing calls take world px; the result
 * becomes a texture whose image sits at (x, y) with origin 0.
 */
export class Pix {
  /** World position of the texture's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** Size in art pixels. */
  readonly w: number;
  readonly h: number;
  private buf: Uint8ClampedArray<ArrayBuffer>;
  private color = 0;
  private alpha = 1;
  private lineColor = 0;
  private lineAlpha = 1;
  private lineW = 1;
  private snapping: boolean;

  constructor(x: number, y: number, width: number, height: number, opts: PixOptions = {}) {
    const pad = opts.pad ?? 1;
    this.x = Math.floor(x / PX) * PX - pad * PX;
    this.y = Math.floor(y / PX) * PX - pad * PX;
    this.w = Math.ceil((x + width - this.x) / PX) + pad;
    this.h = Math.ceil((y + height - this.y) / PX) + pad;
    this.buf = new Uint8ClampedArray(this.w * this.h * 4);
    this.snapping = opts.snap ?? true;
  }

  /** Erase everything. */
  clear(): this {
    this.buf.fill(0);
    return this;
  }

  // ------------------------------------------------------------ Style

  fillStyle(color: number, alpha = 1): this {
    this.color = this.snapping ? snap(color) : color;
    this.alpha = alpha;
    return this;
  }

  lineStyle(width: number, color: number, alpha = 1): this {
    this.lineW = width;
    this.lineColor = this.snapping ? snap(color) : color;
    this.lineAlpha = alpha;
    return this;
  }

  // -------------------------------------------------------- Rasterizing

  /** Art column of a world x (pixel edges round to the nearest grid line). */
  private ax(x: number): number {
    return Math.round((x - this.x) / PX);
  }

  private ay(y: number): number {
    return Math.round((y - this.y) / PX);
  }

  /** Blend one art pixel. */
  plot(i: number, j: number, color = this.color, alpha = this.alpha): void {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h || alpha <= 0) return;
    const k = (j * this.w + i) * 4;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    if (alpha >= 1) {
      this.buf[k] = r;
      this.buf[k + 1] = g;
      this.buf[k + 2] = b;
      this.buf[k + 3] = 255;
      return;
    }
    const da = this.buf[k + 3] / 255;
    const oa = alpha + da * (1 - alpha);
    this.buf[k] = (r * alpha + this.buf[k] * da * (1 - alpha)) / oa;
    this.buf[k + 1] = (g * alpha + this.buf[k + 1] * da * (1 - alpha)) / oa;
    this.buf[k + 2] = (b * alpha + this.buf[k + 2] * da * (1 - alpha)) / oa;
    this.buf[k + 3] = oa * 255;
  }

  /** Fill every art pixel whose centre is inside the shape, within a world bounding box. */
  private fillWhere(x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => boolean): void {
    const i0 = Math.max(0, Math.floor((x0 - this.x) / PX));
    const i1 = Math.min(this.w - 1, Math.ceil((x1 - this.x) / PX));
    const j0 = Math.max(0, Math.floor((y0 - this.y) / PX));
    const j1 = Math.min(this.h - 1, Math.ceil((y1 - this.y) / PX));
    for (let j = j0; j <= j1; j++) {
      const wy = this.y + (j + 0.5) * PX;
      for (let i = i0; i <= i1; i++) {
        if (inside(this.x + (i + 0.5) * PX, wy)) this.plot(i, j);
      }
    }
  }

  // ------------------------------------------------- Graphics-like API

  fillRect(x: number, y: number, w: number, h: number): this {
    let i0 = this.ax(x);
    let i1 = this.ax(x + w);
    let j0 = this.ay(y);
    let j1 = this.ay(y + h);
    // Anything drawn at all is at least one art pixel.
    if (i1 <= i0 && w > 0) i1 = i0 + 1;
    if (j1 <= j0 && h > 0) j1 = j0 + 1;
    i0 = Math.max(0, i0);
    j0 = Math.max(0, j0);
    for (let j = j0; j < Math.min(j1, this.h); j++) for (let i = i0; i < Math.min(i1, this.w); i++) this.plot(i, j);
    return this;
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, r = 4): this {
    const rr = Math.min(r, w / 2, h / 2);
    return this.fillPoints(
      [
        { x: x + rr, y },
        { x: x + w - rr, y },
        { x: x + w, y: y + rr },
        { x: x + w, y: y + h - rr },
        { x: x + w - rr, y: y + h },
        { x: x + rr, y: y + h },
        { x, y: y + h - rr },
        { x, y: y + rr },
      ],
    );
  }

  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    return this.fillPoints([{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }]);
  }

  fillPoints(points: { x: number; y: number }[], _close = true): this {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    this.fillWhere(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (px, py) => {
      let inside = false;
      for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
        const pa = points[a];
        const pb = points[b];
        if (pa.y > py !== pb.y > py && px < ((pb.x - pa.x) * (py - pa.y)) / (pb.y - pa.y) + pa.x) inside = !inside;
      }
      return inside;
    });
    return this;
  }

  fillCircle(x: number, y: number, r: number): this {
    return this.fillEllipse(x, y, r * 2, r * 2);
  }

  fillEllipse(x: number, y: number, w: number, h: number): this {
    const rx = Math.max(w / 2, PX / 2);
    const ry = Math.max(h / 2, PX / 2);
    this.fillWhere(x - rx, y - ry, x + rx, y + ry, (px, py) => ((px - x) / rx) ** 2 + ((py - y) / ry) ** 2 <= 1.0);
    return this;
  }

  /** A line at least one art pixel thick, stamped along a Bresenham path. */
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    const t = Math.max(1, Math.round(this.lineW / PX));
    const off = Math.floor((t - 1) / 2);
    let i = Math.floor((x1 - this.x) / PX);
    let j = Math.floor((y1 - this.y) / PX);
    const i2 = Math.floor((x2 - this.x) / PX);
    const j2 = Math.floor((y2 - this.y) / PX);
    const di = Math.abs(i2 - i);
    const dj = -Math.abs(j2 - j);
    const si = i < i2 ? 1 : -1;
    const sj = j < j2 ? 1 : -1;
    let err = di + dj;
    for (;;) {
      for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) this.plot(i - off + a, j - off + b, this.lineColor, this.lineAlpha);
      if (i === i2 && j === j2) break;
      const e2 = 2 * err;
      if (e2 >= dj) {
        err += dj;
        i += si;
      }
      if (e2 <= di) {
        err += di;
        j += sj;
      }
    }
    return this;
  }

  strokeRect(x: number, y: number, w: number, h: number): this {
    const t = Math.max(PX, this.lineW);
    const [c, a] = [this.color, this.alpha];
    this.fillStyle(this.lineColor, this.lineAlpha);
    this.color = this.lineColor;
    this.fillRect(x, y, w, t).fillRect(x, y + h - t, w, t).fillRect(x, y, t, h).fillRect(x + w - t, y, t, h);
    [this.color, this.alpha] = [c, a];
    return this;
  }

  strokeCircle(x: number, y: number, r: number): this {
    return this.strokeArc(x, y, r, 0, Math.PI * 2);
  }

  /** Ring segment from angle a0 to a1 (radians, clockwise from +x like Phaser). */
  strokeArc(x: number, y: number, r: number, a0: number, a1: number): this {
    const t = Math.max(PX, this.lineW);
    const full = a1 - a0 >= Math.PI * 2 - 1e-6;
    const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const [c, a] = [this.color, this.alpha];
    this.color = this.lineColor;
    this.alpha = this.lineAlpha;
    this.fillWhere(x - r - t, y - r - t, x + r + t, y + r + t, (px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (d > r + t / 2 || d < r - t / 2) return false;
      if (full) return true;
      const ang = norm(Math.atan2(py - y, px - x) - a0);
      return ang <= a1 - a0;
    });
    [this.color, this.alpha] = [c, a];
    return this;
  }

  // ------------------------------------------------- Art-pixel helpers

  /** Fill a rectangle given in art pixels relative to the canvas (no padding offset). */
  box(i: number, j: number, w: number, h: number, color = this.color, alpha = 1): this {
    for (let y = j; y < j + h; y++) for (let x = i; x < i + w; x++) this.plot(x, y, this.snapping ? snap(color) : color, alpha);
    return this;
  }

  /** Two colours mixed by an ordered dither: `t` 0 is all `a`, 1 is all `b`. World coordinates. */
  dither(x: number, y: number, w: number, h: number, a: number, b: number, t: number): this {
    const ca = this.snapping ? snap(a) : a;
    const cb = this.snapping ? snap(b) : b;
    const i0 = this.ax(x);
    const j0 = this.ay(y);
    const i1 = this.ax(x + w);
    const j1 = this.ay(y + h);
    for (let j = Math.max(0, j0); j < Math.min(j1, this.h); j++) {
      for (let i = Math.max(0, i0); i < Math.min(i1, this.w); i++) {
        this.plot(i, j, t > BAYER[(j % 4) * 4 + (i % 4)] ? cb : ca, 1);
      }
    }
    return this;
  }

  /**
   * Ink outline around every solid shape: transparent pixels that touch an opaque one become
   * `color`. Faint pixels (soft shadows) are left alone.
   */
  outline(color: number = PAL.ink): this {
    const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < this.w && j < this.h && this.buf[(j * this.w + i) * 4 + 3] > 150;
    const edge: number[] = [];
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        if (this.buf[(j * this.w + i) * 4 + 3] > 150) continue;
        if (solid(i - 1, j) || solid(i + 1, j) || solid(i, j - 1) || solid(i, j + 1)) edge.push(i, j);
      }
    }
    for (let k = 0; k < edge.length; k += 2) this.plot(edge[k], edge[k + 1], color, 1);
    return this;
  }

  // ------------------------------------------------------------ Output

  /**
   * Make (or replace) a texture. By default it's scaled up so one art pixel is PX texture px;
   * with `upscale` false it stays at art size (for big layers) and images need setScale(PX).
   */
  toTexture(scene: Phaser.Scene, key: string, upscale = true): string {
    const small = document.createElement('canvas');
    small.width = this.w;
    small.height = this.h;
    small.getContext('2d')!.putImageData(new ImageData(this.buf, this.w, this.h), 0, 0);
    let canvas = small;
    if (upscale) {
      canvas = document.createElement('canvas');
      canvas.width = this.w * PX;
      canvas.height = this.h * PX;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    }
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addCanvas(key, canvas);
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    return key;
  }

  /** Texture plus an image of it placed where it was drawn. */
  toImage(scene: Phaser.Scene, key: string, upscale = true): Phaser.GameObjects.Image {
    this.toTexture(scene, key, upscale);
    return scene.add
      .image(this.x, this.y, key)
      .setOrigin(0, 0)
      .setScale(upscale ? 1 : PX);
  }

  /** Art-pixel column/row in this canvas of an absolute art coordinate (world px / PX). */
  artIndex(ax: number, ay: number): [number, number] {
    return [ax - this.x / PX, ay - this.y / PX];
  }

  /** Whether colours get snapped to the palette. */
  get snaps(): boolean {
    return this.snapping;
  }
}

/**
 * A cached pixel texture: drawn once by `draw` the first time the key is asked for. Returns the
 * key and where the image's top-left belongs, relative to the drawing's origin.
 */
export function pixTexture(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: (p: Pix) => void,
  opts?: PixOptions,
): { key: string; x: number; y: number } {
  const p = new Pix(x, y, w, h, opts);
  if (!scene.textures.exists(key)) {
    draw(p);
    p.toTexture(scene, key);
  }
  return { key, x: p.x, y: p.y };
}

/** A cached pixel image at its drawn position. */
export function pixImage(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: (p: Pix) => void,
  opts?: PixOptions,
): Phaser.GameObjects.Image {
  const t = pixTexture(scene, key, x, y, w, h, draw, opts);
  return scene.add.image(t.x, t.y, t.key).setOrigin(0, 0);
}

/** Mix of two colours, snapped back onto the palette. */
export function shade(c: number, toward: number, t: number): number {
  const k = Phaser.Math.Clamp(t, 0, 1);
  const mix = (s: number) => Math.round(((c >> s) & 0xff) * (1 - k) + ((toward >> s) & 0xff) * k);
  return snap((mix(16) << 16) | (mix(8) << 8) | mix(0));
}
