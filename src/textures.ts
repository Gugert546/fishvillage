import Phaser from 'phaser';
import { FISH, HAZARD_INFO } from './config';
import { lerpColor } from './ui';
import { Art } from './art/kit';
import { PAL, Pix } from './pixel';

/**
 * A pixel canvas for a creature texture. Fish keep their own colours (not snapped to the
 * palette) so species stay easy to tell apart.
 */
function creature(w: number, h: number): Pix {
  return new Pix(0, 0, w, h, { snap: false });
}

/** Outline the drawing and store it as a texture. */
function finish(g: Pix, scene: Phaser.Scene, key: string): void {
  g.outline(PAL.ink);
  g.toTexture(scene, key);
}

/** Generates the creature and hook textures once per game; safe to call from every scene. */
export function makeTextures(scene: Phaser.Scene): void {
  for (const type of FISH) {
    if (scene.textures.exists(`fish-${type.id}`)) continue;
    const { width: w, height: h } = type;
    const tail = Math.round(h * 0.8);
    // Billfish grow a sword past their nose.
    const extra = type.look === 'bill' ? Math.round(w * 0.35) : 0;
    const g = creature(tail + w + extra, h);
    g.fillStyle(lerpColor(type.color, 0x000000, 0.25));
    g.fillTriangle(0, h * 0.05, 0, h * 0.95, tail + 3, h / 2);
    g.fillStyle(type.color);
    g.fillEllipse(tail + w / 2, h / 2, w, h);
    g.fillStyle(lerpColor(type.color, 0xffffff, 0.35));
    g.fillEllipse(tail + w / 2, h * 0.65, w * 0.7, h * 0.35);
    const eyeR = Math.max(2, h * 0.13);
    g.fillStyle(0xffffff);
    g.fillCircle(tail + w * 0.78, h * 0.38, eyeR);
    g.fillStyle(0x111111);
    g.fillCircle(tail + w * 0.8, h * 0.38, eyeR * 0.55);
    if (type.id === 'angler') {
      // Anglerfish lure
      g.fillStyle(0xfff3a0);
      g.fillCircle(tail + w - 3, 4, 3.5);
    }
    if (type.look === 'stripes') {
      g.fillStyle(0xffffff, 0.9);
      for (const f of [0.3, 0.55, 0.78]) g.fillRect(tail + w * f - 2, h * 0.12, 4, h * 0.76);
    } else if (type.look === 'bill') {
      // Long sword sticking out of the nose.
      g.fillStyle(lerpColor(type.color, 0xffffff, 0.2));
      g.fillTriangle(tail + w - 4, h * 0.38, tail + w - 4, h * 0.52, tail + w + extra, h * 0.45);
      g.fillTriangle(tail + w * 0.35, h * 0.2, tail + w * 0.55, h * 0.2, tail + w * 0.4, 0);
    } else if (type.look === 'flat') {
      g.fillStyle(lerpColor(type.color, 0x000000, 0.2));
      for (const f of [0.3, 0.5, 0.7]) g.fillCircle(tail + w * f, h * 0.35, 2.5);
    } else if (type.look === 'squid' || type.look === 'crab') {
      // Redraw over the fish body: these aren't fish-shaped.
      g.clear();
      const dark = lerpColor(type.color, 0x000000, 0.3);
      const W = tail + w;
      if (type.look === 'squid') {
        g.fillStyle(dark);
        for (let i = 0; i < 5; i++) g.fillRect(0, h * 0.25 + i * h * 0.11, W * 0.45, 2.5);
        g.fillStyle(type.color);
        g.fillEllipse(W * 0.68, h / 2, W * 0.62, h * 0.7);
        g.fillTriangle(W - 2, h / 2, W * 0.82, h * 0.1, W * 0.82, h * 0.9);
        g.fillStyle(0xffffff);
        g.fillCircle(W * 0.48, h * 0.42, 3.5);
        g.fillStyle(0x111111);
        g.fillCircle(W * 0.47, h * 0.42, 2);
      } else {
        g.fillStyle(dark);
        for (const f of [0.25, 0.4, 0.6, 0.75]) {
          g.fillRect(W * f - 1, h * 0.55, 2.5, h * 0.45);
        }
        g.fillTriangle(W * 0.05, h * 0.15, W * 0.2, h * 0.5, W * 0.12, h * 0.55);
        g.fillTriangle(W * 0.95, h * 0.15, W * 0.8, h * 0.5, W * 0.88, h * 0.55);
        g.fillStyle(type.color);
        g.fillEllipse(W / 2, h * 0.5, W * 0.6, h * 0.6);
        g.fillCircle(W * 0.1, h * 0.15, 4);
        g.fillCircle(W * 0.9, h * 0.15, 4);
        g.fillStyle(0x111111);
        g.fillCircle(W * 0.42, h * 0.35, 1.8);
        g.fillCircle(W * 0.58, h * 0.35, 1.8);
      }
    }
    finish(g, scene, `fish-${type.id}`);
  }

  makeHazardTextures(scene);

  if (!scene.textures.exists('hook')) {
    const g = new Pix(0, 0, 14, 22);
    const a = new Art(g);
    a.r(4, 0, 3, 1, PAL.cloud).d(4, 1, PAL.cloud).d(6, 1, PAL.cloud);
    a.vl(5, 2, 6, PAL.white).vl(6, 2, 6, PAL.mist);
    a.d(5, 8, PAL.white).r(2, 9, 3, 1, PAL.cloud).d(1, 8, PAL.white).vl(1, 6, 2, PAL.white).d(2, 6, PAL.cloud);
    finish(g, scene, 'hook');
  }
}

function makeHazardTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('hazard-shark')) return;

  let { width: w, height: h } = HAZARD_INFO.shark;
  let g = creature(w, h);
  g.fillStyle(0x5d6d7e);
  g.fillTriangle(0, 2, 0, h - 2, 18, h / 2 + 2); // tail
  g.fillTriangle(w * 0.42, h * 0.3, w * 0.58, h * 0.3, w * 0.45, 0); // dorsal fin
  g.fillStyle(0x7f8c9a);
  g.fillEllipse(14 + (w - 14) / 2, h * 0.6, w - 14, h * 0.75);
  g.fillStyle(0xe8edf1);
  g.fillEllipse(14 + (w - 14) * 0.55, h * 0.78, (w - 14) * 0.7, h * 0.3);
  g.fillStyle(0x111111);
  g.fillCircle(w * 0.84, h * 0.5, 2.2);
  g.lineStyle(1.5, 0x2c3e50);
  g.lineBetween(w * 0.86, h * 0.72, w * 0.97, h * 0.66);
  finish(g, scene, 'hazard-shark');

  ({ width: w, height: h } = HAZARD_INFO.jelly);
  g = creature(w, h);
  g.lineStyle(2, 0xd291e8);
  for (let i = 0; i < 4; i++) {
    const x = 5 + i * 5.5;
    g.lineBetween(x, h * 0.45, x + (i % 2 ? 2 : -2), h);
  }
  // Bell: the top half of a circle
  const bell: { x: number; y: number }[] = [];
  for (let k = 0; k <= 12; k++) {
    const ang = Math.PI + (k / 12) * Math.PI;
    bell.push({ x: w / 2 + Math.cos(ang) * (w / 2), y: h * 0.48 + Math.sin(ang) * (w / 2) });
  }
  g.fillStyle(0xe7b6f7).fillPoints(bell);
  g.fillStyle(0xffffff).fillCircle(w * 0.35, h * 0.28, 2);
  finish(g, scene, 'hazard-jelly');

  ({ width: w, height: h } = HAZARD_INFO.ice);
  g = creature(w, h);
  g.fillStyle(0xd6eef8);
  g.fillPoints(
    [
      { x: 6, y: 0 },
      { x: w - 12, y: 2 },
      { x: w, y: h * 0.45 },
      { x: w - 8, y: h },
      { x: 10, y: h - 2 },
      { x: 0, y: h * 0.5 },
    ],
  );
  g.fillStyle(0xffffff);
  g.fillRect(10, 3, w - 26, 4);
  g.fillStyle(0xa9d6e5);
  g.fillRect(14, h - 7, w - 30, 3);
  finish(g, scene, 'hazard-ice');
}

/**
 * A screen-sized black veil with a soft hole in the middle, for dark waters. Drawn at a third of
 * the size and scaled up (it's only a gradient), so it's cheap.
 */
export function makeDarknessTexture(scene: Phaser.Scene, width: number, height: number): void {
  const key = 'darkness';
  if (scene.textures.exists(key)) return;
  const w = Math.ceil(width / 3);
  const h = Math.ceil(height / 3);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(w / 2, h / 2, 28, w / 2, h / 2, 58);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  tex.refresh();
}
