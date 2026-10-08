// Small pixel icons for the HUD and building markers. Each is centred on (0, 0).

import Phaser from 'phaser';
import { PAL, pixTexture } from '../pixel';
import { Art } from './kit';

/** Level badge behind a building's level number. */
export function badgeTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'icon-badge', -10, -10, 20, 20, (p) => {
    const a = new Art(p);
    a.r(-4, -5, 8, 10, PAL.white).r(-5, -4, 10, 8, PAL.white);
    a.r(-3, -4, 6, 8, PAL.navy).r(-4, -3, 8, 6, PAL.navy);
    a.outline();
  }).key;
}

/** Round alert marker: red for "help wanted", blue for "no water". */
export function pipTexture(scene: Phaser.Scene, color: 'red' | 'blue'): string {
  return pixTexture(scene, `icon-pip-${color}`, -10, -10, 20, 20, (p) => {
    p.fillStyle(PAL.white).fillCircle(0, 0, 9);
    p.fillStyle(color === 'red' ? PAL.red : PAL.sky).fillCircle(0, 0, 7);
    p.outline();
  }).key;
}

export function coinTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'icon-coin', -10, -10, 20, 20, (p) => {
    const a = new Art(p);
    a.r(-3, -5, 6, 10, PAL.orange).r(-5, -3, 10, 6, PAL.orange).r(-4, -4, 8, 8, PAL.orange);
    a.r(-3, -4, 5, 8, PAL.amber).r(-4, -3, 7, 6, PAL.amber);
    a.vl(-1, -3, 6, PAL.yellow).d(-2, -3, PAL.white);
    a.outline();
  }).key;
}

export function personIconTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'icon-person', -8, -10, 16, 20, (p) => {
    const a = new Art(p);
    a.r(-2, -5, 4, 4, PAL.white).r(-3, -4, 6, 2, PAL.white);
    a.r(-4, 0, 8, 5, PAL.white).r(-3, -1, 6, 1, PAL.white);
    a.outline();
  }).key;
}

/** Mood face: happy, flat or sad. */
export function faceTexture(scene: Phaser.Scene, kind: 'happy' | 'flat' | 'sad'): string {
  const color = kind === 'happy' ? PAL.lime : kind === 'sad' ? PAL.salmon : PAL.yellow;
  return pixTexture(scene, `icon-face-${kind}`, -10, -10, 20, 20, (p) => {
    const a = new Art(p);
    a.r(-3, -5, 6, 10, color).r(-5, -3, 10, 6, color).r(-4, -4, 8, 8, color);
    a.d(-2, -2, PAL.ink).d(1, -2, PAL.ink);
    if (kind === 'happy') a.d(-3, 1, PAL.ink).hl(-2, 2, 4, PAL.ink).d(2, 1, PAL.ink);
    else if (kind === 'sad') a.d(-3, 3, PAL.ink).hl(-2, 2, 4, PAL.ink).d(2, 3, PAL.ink);
    else a.hl(-2, 2, 4, PAL.ink);
    a.outline();
  }).key;
}

export function gearTexture(scene: Phaser.Scene): string {
  return pixTexture(scene, 'icon-gear', -12, -12, 24, 24, (p) => {
    const a = new Art(p);
    a.r(-4, -4, 8, 8, PAL.cloud);
    for (const [x, y] of [[-1, -6], [-1, 4], [-6, -1], [4, -1]]) a.r(x, y, 2, 2, PAL.cloud);
    for (const [x, y] of [[-5, -5], [3, -5], [-5, 3], [3, 3]]) a.r(x, y, 2, 2, PAL.cloud);
    a.r(-5, -3, 10, 6, PAL.cloud).r(-3, -5, 6, 10, PAL.cloud);
    a.r(-1, -1, 2, 2, PAL.slate);
    a.d(-3, -3, PAL.white);
    a.outline();
  }).key;
}
