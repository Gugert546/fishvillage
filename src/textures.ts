import Phaser from 'phaser';
import { FISH, HAZARD_INFO } from './config';
import { lerpColor } from './ui';

/** Generates the programmer-art textures once per game; safe to call from every scene. */
export function makeTextures(scene: Phaser.Scene): void {
  for (const type of FISH) {
    if (scene.textures.exists(`fish-${type.id}`)) continue;
    const { width: w, height: h } = type;
    const tail = Math.round(h * 0.8);
    const g = scene.make.graphics({}, false);
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
    let extra = 0;
    if (type.look === 'stripes') {
      g.fillStyle(0xffffff, 0.9);
      for (const f of [0.3, 0.55, 0.78]) g.fillRect(tail + w * f - 2, h * 0.12, 4, h * 0.76);
    } else if (type.look === 'bill') {
      // Long sword sticking out of the nose; the texture grows to fit it.
      extra = Math.round(w * 0.35);
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
    g.generateTexture(`fish-${type.id}`, tail + w + extra, h);
    g.destroy();
  }

  makeHazardTextures(scene);

  if (!scene.textures.exists('hook')) {
    const g = scene.make.graphics({}, false);
    g.lineStyle(3, 0xe8e8e8);
    g.beginPath();
    g.moveTo(10, 2);
    g.lineTo(10, 14);
    g.arc(6, 14, 4, 0, Math.PI, false);
    g.lineTo(2, 10);
    g.strokePath();
    g.fillStyle(0xe8e8e8);
    g.fillCircle(10, 2, 2);
    g.generateTexture('hook', 14, 22);
    g.destroy();
  }
}

function makeHazardTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('hazard-shark')) return;

  let { width: w, height: h } = HAZARD_INFO.shark;
  let g = scene.make.graphics({}, false);
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
  g.generateTexture('hazard-shark', w, h);
  g.destroy();

  ({ width: w, height: h } = HAZARD_INFO.jelly);
  g = scene.make.graphics({}, false);
  g.lineStyle(2, 0xd291e8, 0.8);
  for (let i = 0; i < 4; i++) {
    const x = 5 + i * 5.5;
    g.lineBetween(x, h * 0.45, x + (i % 2 ? 2 : -2), h);
  }
  g.fillStyle(0xe7b6f7, 0.9);
  g.slice(w / 2, h * 0.48, w / 2, Math.PI, 0, false);
  g.fillPath();
  g.fillStyle(0xffffff, 0.5);
  g.fillCircle(w * 0.35, h * 0.28, 3);
  g.generateTexture('hazard-jelly', w, h);
  g.destroy();

  ({ width: w, height: h } = HAZARD_INFO.ice);
  g = scene.make.graphics({}, false);
  g.fillStyle(0xd6eef8);
  g.fillPoints(
    [
      { x: 6, y: 0 },
      { x: w - 12, y: 2 },
      { x: w, y: h * 0.45 },
      { x: w - 8, y: h },
      { x: 10, y: h - 2 },
      { x: 0, y: h * 0.5 },
    ].map((v) => new Phaser.Math.Vector2(v.x, v.y)),
    true,
  );
  g.fillStyle(0xffffff);
  g.fillRect(10, 3, w - 26, 4);
  g.fillStyle(0xa9d6e5);
  g.fillRect(14, h - 7, w - 30, 3);
  g.generateTexture('hazard-ice', w, h);
  g.destroy();
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
