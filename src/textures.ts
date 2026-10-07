import Phaser from 'phaser';
import { FISH } from './config';
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
    if (type.erratic) {
      // Anglerfish lure
      g.fillStyle(0xfff3a0);
      g.fillCircle(tail + w - 3, 4, 3.5);
    }
    g.generateTexture(`fish-${type.id}`, tail + w, h);
    g.destroy();
  }

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
