import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { incomePerMinute, skipTime, takeOfflineReport } from './economy';
import { townHappiness } from './happiness';
import { housingCapacity } from './population';
import { resetGame, save, state } from './state';

export const UI_DEPTH = 100;

export function makeText(scene: Phaser.Scene, x: number, y: number, text: string, size: number): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: `${size}px`,
    fontStyle: 'bold',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: Math.max(2, Math.round(size / 7)),
    resolution: Math.min(3, window.devicePixelRatio || 1) * 2,
  });
}

/** Linear blend between two 0xRRGGBB colors. */
export function lerpColor(a: number, b: number, t: number): number {
  const k = Phaser.Math.Clamp(t, 0, 1);
  const mix = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - k) + ((b >> shift) & 0xff) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function formatCoins(n: number): string {
  const v = Math.floor(n);
  // "10.0k" reads worse than "10k", so drop a trailing ".0".
  const short = (x: number, digits: number) => x.toFixed(digits).replace(/\.0$/, '');
  if (v >= 1_000_000) return `${short(v / 1_000_000, v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${short(v / 1000, v >= 100_000 ? 0 : 1)}k`;
  return `${v}`;
}

/** An income rate without the unit: one decimal below 10 (dropping ".0"), then like coins. */
export function formatRate(v: number): string {
  return v < 10 ? v.toFixed(1).replace(/\.0$/, '') : formatCoins(v);
}

/** Pin an object (and every child, for containers) to the screen so it ignores camera scroll. */
export function fixToScreen<T extends Phaser.GameObjects.GameObject>(obj: T): T {
  if (obj instanceof Phaser.GameObjects.Container) {
    obj.setScrollFactor(0);
    for (const child of obj.list) fixToScreen(child);
  } else if ('setScrollFactor' in obj) {
    (obj as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor(0);
  }
  return obj;
}

export const COLORS = {
  primary: 0xf5a623,
  buy: 0x52b788,
  disabled: 0x6c757d,
  neutral: 0x457b9d,
  danger: 0xc0392b,
  panel: 0x1d3557,
  gold: '#ffe066',
};

export interface Button extends Phaser.GameObjects.Container {
  setEnabledLook(enabled: boolean, color?: number): void;
  setLabel(text: string): void;
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  color = COLORS.primary,
  fontSize = 22,
): Button {
  const bg = scene.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0x000000, 0.25);
  const text = makeText(scene, 0, 0, label, fontSize).setOrigin(0.5);
  const c = scene.add.container(x, y, [bg, text]) as Button;
  // Only fire when the press started on this button, so a button that appears under a
  // finger mid-tap (e.g. in a freshly opened dialog) can't be triggered by the release.
  let pressed = false;
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerdown', () => {
    pressed = true;
    bg.setScale(0.95);
  });
  bg.on('pointerout', () => {
    pressed = false;
    bg.setScale(1);
  });
  bg.on('pointerup', () => {
    bg.setScale(1);
    if (!pressed) return;
    pressed = false;
    onClick();
  });
  c.setEnabledLook = (enabled, onColor = color) => bg.setFillStyle(enabled ? onColor : COLORS.disabled);
  c.setLabel = (s) => text.setText(s);
  return c;
}

/** A centered panel over a dimmed screen that swallows taps behind it. */
export class Modal {
  readonly container: Phaser.GameObjects.Container;
  readonly top: number;

  constructor(
    private scene: Phaser.Scene,
    readonly height: number,
  ) {
    const shade = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55).setOrigin(0).setInteractive();
    const panel = scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH - 40, height, COLORS.panel)
      .setStrokeStyle(3, 0xf1faee, 0.6);
    this.container = fixToScreen(scene.add.container(0, 0, [shade, panel]).setDepth(UI_DEPTH + 10));
    this.top = GAME_HEIGHT / 2 - height / 2;
  }

  add(...objs: Phaser.GameObjects.GameObject[]): this {
    for (const o of objs) this.container.add(fixToScreen(o));
    return this;
  }

  text(x: number, y: number, s: string, size: number, originX = 0.5): Phaser.GameObjects.Text {
    const t = makeText(this.scene, x, y, s, size).setOrigin(originX, 0.5);
    this.add(t);
    return t;
  }

  destroy(): void {
    this.container.destroy();
  }
}

/** Coins, income and population pinned to the top of the screen. */
export class TopBar {
  private coins: Phaser.GameObjects.Text;
  private income: Phaser.GameObjects.Text;
  private population: Phaser.GameObjects.Text;
  private personIcon: Phaser.GameObjects.Graphics;
  private mood: Phaser.GameObjects.Text;
  private face: Phaser.GameObjects.Graphics;
  private lastFace = '';
  private showPopulation: boolean;
  private gear?: Phaser.GameObjects.Container;
  /** Invisible tap target over the population counter. */
  private populationHit?: Phaser.GameObjects.Rectangle;
  /** Right edge for the readouts, left of the settings gear. */
  private rightEdge: number;
  /** Free slot on the right for scene-specific info (e.g. line depth while fishing). */
  readonly right: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, showPopulation = true, onSettings?: () => void, onPopulation?: () => void) {
    this.rightEdge = onSettings ? GAME_WIDTH - 46 : GAME_WIDTH - 14;
    this.personIcon = scene.add.graphics();
    this.personIcon.fillStyle(0xf1faee);
    this.personIcon.fillCircle(0, -6, 4.5);
    this.personIcon.fillRoundedRect(-6, 0, 12, 10, 4);
    this.face = scene.add.graphics();
    this.showPopulation = showPopulation;
    const items: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth)[] = [
      scene.add.rectangle(0, 0, GAME_WIDTH, 44, 0x000000, 0.35).setOrigin(0),
      scene.add.circle(22, 22, 10, 0xf5c542).setStrokeStyle(2, 0xb8860b),
      (this.coins = makeText(scene, 40, 22, '', 20).setOrigin(0, 0.5)),
      (this.income = makeText(scene, 0, 24, '', 14).setOrigin(0, 0.5).setColor(COLORS.gold)),
      this.personIcon,
      (this.population = makeText(scene, 0, 22, '', 18).setOrigin(0, 0.5)),
      this.face,
      (this.mood = makeText(scene, 0, 22, '', 18).setOrigin(0, 0.5)),
      (this.right = makeText(scene, this.rightEdge, 22, '', 18).setOrigin(1, 0.5)),
    ];
    if (onSettings) items.push((this.gear = makeGearButton(scene, GAME_WIDTH - 22, 22, onSettings)));
    if (onPopulation && showPopulation) {
      this.populationHit = scene.add.rectangle(0, 22, 80, 44, 0x000000, 0.001).setOrigin(0, 0.5);
      onTap(this.populationHit, onPopulation);
      items.push(this.populationHit);
    }
    for (const o of items) fixToScreen(o).setDepth(UI_DEPTH);
    for (const o of [this.personIcon, this.population, this.face, this.mood]) o.setVisible(showPopulation);
    this.update();
  }

  update(): void {
    this.coins.setText(formatCoins(state.coins));
    const perMin = incomePerMinute();
    this.income.setX(this.coins.x + this.coins.width + 10);
    this.income.setText(perMin > 0 ? `+${formatRate(perMin)}/min` : '');

    if (!this.showPopulation) return;
    this.population.setText(`${state.residents.length}/${housingCapacity()}`);
    this.population.setX(this.rightEdge - this.population.width);
    this.personIcon.setPosition(this.population.x - 12, 22);
    this.populationHit?.setX(this.population.x - 24).setSize(this.population.width + 30, 44);

    const h = townHappiness();
    this.mood.setText(h === null ? '–' : `${Math.round(h)}%`);
    this.mood.setX(this.personIcon.x - 22 - this.mood.width);
    this.face.setPosition(this.mood.x - 14, 22);
    this.drawFace(h);
  }

  /** Hide the gear while it shouldn't be used (e.g. mid-cast). */
  setSettingsVisible(visible: boolean): void {
    this.gear?.setVisible(visible);
  }

  /** Smiley whose mouth follows the mood: frown below 35%, flat to 65%, smile above. */
  private drawFace(h: number | null): void {
    const kind = h === null ? 'flat' : h < 35 ? 'sad' : h < 65 ? 'flat' : 'happy';
    if (kind === this.lastFace) return;
    this.lastFace = kind;
    const g = this.face.clear();
    const color = kind === 'happy' ? 0x8ee88e : kind === 'sad' ? 0xff8a8a : 0xffe066;
    g.fillStyle(color);
    g.fillCircle(0, 0, 10);
    g.fillStyle(0x1d3557);
    g.fillCircle(-3.5, -3, 1.6);
    g.fillCircle(3.5, -3, 1.6);
    g.lineStyle(2, 0x1d3557);
    g.beginPath();
    if (kind === 'happy') g.arc(0, 1, 5, 0.15 * Math.PI, 0.85 * Math.PI, false);
    else if (kind === 'sad') g.arc(0, 8, 5, 1.2 * Math.PI, 1.8 * Math.PI, false);
    else {
      g.moveTo(-4, 4);
      g.lineTo(4, 4);
    }
    g.strokePath();
  }
}

/** Shows the welcome-back popup if income was earned while away. Returns the modal, if any. */
export function showOfflineEarnings(scene: Phaser.Scene, onClose: () => void): Modal | undefined {
  const report = takeOfflineReport();
  if (!report) return undefined;
  const extra = report.residents > 0 ? 30 : 0;
  const m = new Modal(scene, 230 + extra);
  m.text(GAME_WIDTH / 2, m.top + 40, 'Welcome back!', 28);
  m.text(GAME_WIDTH / 2, m.top + 82, 'Your town earned', 18).setAlpha(0.8);
  m.text(GAME_WIDTH / 2, m.top + 122, `+$${formatCoins(report.coins)}`, 34).setColor(COLORS.gold);
  if (report.residents > 0) {
    const who = report.residents === 1 ? '1 new resident' : `${report.residents} new residents`;
    m.text(GAME_WIDTH / 2, m.top + 160, `and ${who} moved in`, 16).setAlpha(0.85);
  }
  m.add(
    makeButton(scene, GAME_WIDTH / 2, m.top + 185 + extra, 160, 46, 'Collect', () => {
      m.destroy();
      onClose();
    }),
  );
  return m;
}

function makeGearButton(scene: Phaser.Scene, x: number, y: number, onClick: () => void): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0xf1faee);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.fillCircle(Math.cos(a) * 8, Math.sin(a) * 8, 2.8);
  }
  g.fillCircle(0, 0, 7.5);
  g.fillStyle(0x3a3a3a);
  g.fillCircle(0, 0, 3);
  // Generous invisible hit area so it's easy to tap.
  const hit = scene.add.rectangle(0, 0, 42, 42, 0x000000, 0.001);
  let pressed = false;
  hit.setInteractive({ useHandCursor: true });
  hit.on('pointerdown', () => {
    pressed = true;
    g.setScale(0.9);
  });
  hit.on('pointerout', () => {
    pressed = false;
    g.setScale(1);
  });
  hit.on('pointerup', () => {
    g.setScale(1);
    if (!pressed) return;
    pressed = false;
    onClick();
  });
  return scene.add.container(x, y, [hit, g]);
}

/**
 * Settings dialog. `setModal` lets the owning scene track whichever dialog is open, since this
 * swaps between the settings panel and the reset confirmation.
 */
export function openSettings(scene: Phaser.Scene, setModal: (m: Modal | undefined) => void): void {
  // Playtesting tools only exist in dev builds (npm run dev), never in a shipped game.
  const cheats = import.meta.env.DEV;
  const m = new Modal(scene, cheats ? 400 : 200);
  setModal(m);
  const close = () => {
    m.destroy();
    setModal(undefined);
  };
  m.text(GAME_WIDTH / 2, m.top + 34, 'Settings', 28);
  let y = m.top + 90;

  if (cheats) {
    m.text(GAME_WIDTH / 2, y, 'Playtesting', 18).setColor(COLORS.gold);
    y += 46;
    const grants: [string, number][] = [['+$1k', 1_000], ['+$10k', 10_000], ['+$100k', 100_000]];
    grants.forEach(([label, amount], i) => {
      const btn = makeButton(scene, GAME_WIDTH / 2 + (i - 1) * 124, y, 112, 46, label, () => {
        state.coins += amount;
        save();
      }, COLORS.buy, 18);
      m.add(btn);
    });
    y += 60;
    m.add(
      makeButton(scene, GAME_WIDTH / 2, y, 236, 46, 'Skip 1 hour', () => {
        skipTime(3600);
        close();
      }, COLORS.neutral, 18),
    );
    y += 72;
  }

  m.add(
    makeButton(scene, GAME_WIDTH / 2, y, 236, 46, 'Reset game', () => {
      m.destroy();
      confirmReset(scene, setModal);
    }, COLORS.danger, 18),
    makeButton(scene, GAME_WIDTH / 2, m.top + m.height - 36, 160, 44, 'Close', close, COLORS.neutral),
  );
}

function confirmReset(scene: Phaser.Scene, setModal: (m: Modal | undefined) => void): void {
  // Tall enough that its buttons sit below where the settings' Reset button was, so a quick
  // double tap can't wipe the save.
  const m = new Modal(scene, 340);
  setModal(m);
  m.text(GAME_WIDTH / 2, m.top + 40, 'Reset everything?', 26);
  m.text(GAME_WIDTH / 2, m.top + 100, 'Your town, coins and gear', 17).setAlpha(0.85);
  m.text(GAME_WIDTH / 2, m.top + 126, 'will be gone for good.', 17).setAlpha(0.85);
  const y = m.top + m.height - 46;
  m.add(
    makeButton(scene, GAME_WIDTH * 0.3, y, 150, 48, 'Reset', () => resetGame(), COLORS.danger),
    makeButton(scene, GAME_WIDTH * 0.7, y, 150, 48, 'Cancel', () => {
      m.destroy();
      openSettings(scene, setModal);
    }, COLORS.neutral),
  );
}

/** Tap handler that only fires when the press started on the object (see makeButton). */
export function onTap(obj: Phaser.GameObjects.GameObject, handler: () => void): void {
  let pressed = false;
  obj.setInteractive({ useHandCursor: true });
  obj.on('pointerdown', () => (pressed = true));
  obj.on('pointerout', () => (pressed = false));
  obj.on('pointerup', () => {
    if (!pressed) return;
    pressed = false;
    handler();
  });
}

/** A full-width tappable row for lists; add your own texts/icons to the returned container. */
export function makeListRow(
  scene: Phaser.Scene,
  y: number,
  h: number,
  onClick: (() => void) | null,
  highlight = false,
): Phaser.GameObjects.Container {
  const w = GAME_WIDTH - 64;
  const bg = scene.add.rectangle(GAME_WIDTH / 2, y, w, h - 6, 0x264b73, onClick ? 1 : 0.45);
  if (highlight) bg.setStrokeStyle(2, 0x8ee88e);
  if (onClick) onTap(bg, onClick);
  return scene.add.container(0, 0, [bg]);
}

/** Toasts on screen per scene, so new ones stack below; destroyed ones drop out by themselves. */
const liveToasts = new WeakMap<Phaser.Scene, Phaser.GameObjects.Container[]>();

/** A short message that slides in under the top bar and fades away. */
export function showToast(scene: Phaser.Scene, text: string): void {
  const live = (liveToasts.get(scene) ?? []).filter((t) => t.active);
  const y = 74 + live.length * 46;
  const label = makeText(scene, 0, 0, text, 16).setOrigin(0.5);
  const bg = scene.add
    .rectangle(0, 0, Math.min(GAME_WIDTH - 30, label.width + 36), 38, 0x2d6a4f)
    .setStrokeStyle(2, 0x8ee88e);
  const toast = fixToScreen(scene.add.container(GAME_WIDTH / 2, y - 30, [bg, label]).setDepth(UI_DEPTH + 20).setAlpha(0));
  liveToasts.set(scene, [...live, toast]);
  scene.tweens.add({ targets: toast, y, alpha: 1, duration: 250, ease: 'Back.Out' });
  scene.tweens.add({ targets: toast, alpha: 0, delay: 2800, duration: 400, onComplete: () => toast.destroy() });
}
