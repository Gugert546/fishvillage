import Phaser from 'phaser';
import { AREAS, GAME_HEIGHT, GAME_WIDTH, LOGBOOK_PAGE_BONUS, type FishType } from './config';
import { incomePerMinute, skipTime, takeOfflineReport } from './economy';
import { townHappiness } from './happiness';
import { discovered, legendOf, pageComplete, pageProgress, regularFish, speciesCount, totalSpecies } from './logbook';
import { crateCapacity, cratesUsed } from './crates';
import { dailyFactor, priceBonuses, salePrice, sellAll, sellType, stock, stockValue } from './market';
import { housingCapacity } from './population';
import { resetGame, save, state } from './state';
import { setMusic, setSound, sfx } from './sound';
import { devFillBarrels, devLegendNextCast, devMaxTownLevel, devUnlockGear, freeMode, setFreeMode } from './dev';
import { coinTexture, faceTexture, gearTexture, personIconTexture } from './art/icons';

export const UI_DEPTH = 100;

/** The pixel font (bundled, see main.ts), with a fallback while it loads. */
export const FONT = '"Tiny5", monospace';

/**
 * Tiny5 is drawn on an 8 px grid, so it's only crisp at multiples of 8. Every requested size is
 * snapped to the nearest crisp one: 16 for body text, 24 for buttons and titles, 32 for big
 * numbers. (8 would be crisp too, but is too small to read on a phone.)
 */
export function crispSize(size: number): number {
  return size < 20 ? 16 : size < 28 ? 24 : 32;
}

export function makeText(scene: Phaser.Scene, x: number, y: number, text: string, size: number): Phaser.GameObjects.Text {
  // Drawn at game resolution and scaled up with the same chunky pixels as the art; outline and
  // drop shadow are whole font pixels so the edges stay sharp.
  const px = crispSize(size);
  const shadow = px / 8;
  return scene.add.text(x, y, text, {
    fontFamily: FONT,
    fontSize: `${px}px`,
    color: '#ffffff',
    stroke: '#181425',
    strokeThickness: 2,
    shadow: { offsetX: shadow, offsetY: shadow, color: '#181425', blur: 0, stroke: true, fill: true },
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

/** UI colours, from the same Endesga 32 palette as the art (see pixel.ts). */
export const COLORS = {
  primary: 0xf77622,
  buy: 0x3e8948,
  disabled: 0x5a6988,
  neutral: 0x124e89,
  danger: 0xa22633,
  panel: 0x262b44,
  /** Cards and list rows inside a panel. */
  card: 0x3a4466,
  /** Empty part of a progress bar. */
  track: 0x181425,
  /** Progress bar fill, and when it's complete. */
  progress: 0xfeae34,
  complete: 0x63c74d,
  ink: 0x181425,
  gold: '#fee761',
};

/**
 * A pixel-art frame centred on (0, 0): ink border with clipped corners, a light rim and a
 * darker lip along the bottom. Draw it over a plain fill of the same size.
 */
export function drawBevel(g: Phaser.GameObjects.Graphics, w: number, h: number, lip = 4): Phaser.GameObjects.Graphics {
  const x = -w / 2;
  const y = -h / 2;
  g.clear();
  g.fillStyle(COLORS.ink);
  g.fillRect(x + 2, y, w - 4, 2).fillRect(x + 2, y + h - 2, w - 4, 2).fillRect(x, y + 2, 2, h - 4).fillRect(x + w - 2, y + 2, 2, h - 4);
  g.fillStyle(0xffffff, 0.3).fillRect(x + 2, y + 2, w - 4, 2);
  if (lip > 0) g.fillStyle(0x000000, 0.28).fillRect(x + 2, y + h - 2 - lip, w - 4, lip);
  return g;
}

/** A framed panel: fill plus bevel, centred on (x, y). */
export function makePanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill: number, alpha = 1): Phaser.GameObjects.Container {
  const bg = scene.add.rectangle(0, 0, w - 4, h - 4, fill, alpha);
  const rim = drawBevel(scene.add.graphics(), w, h, 0);
  return scene.add.container(x, y, [bg, rim]);
}

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
  const bg = scene.add.rectangle(0, 0, w - 2, h - 2, color);
  const bevel = drawBevel(scene.add.graphics(), w, h);
  const text = makeText(scene, 0, -1, label, fontSize).setOrigin(0.5);
  const c = scene.add.container(x, y, [bg, bevel, text]) as Button;
  // Only fire when the press started on this button, so a button that appears under a
  // finger mid-tap (e.g. in a freshly opened dialog) can't be triggered by the release.
  let pressed = false;
  bg.setInteractive({ useHandCursor: true });
  // Pressed: the face drops onto its lip.
  const press = (down: boolean) => {
    bevel.setY(down ? 2 : 0);
    text.setY(down ? 1 : -1);
    bg.setY(down ? 2 : 0);
  };
  bg.on('pointerdown', () => {
    pressed = true;
    press(true);
  });
  bg.on('pointerout', () => {
    pressed = false;
    press(false);
  });
  bg.on('pointerup', () => {
    press(false);
    if (!pressed) return;
    pressed = false;
    sfx.tap();
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
    const shade = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.6).setOrigin(0).setInteractive();
    const panel = makePanel(scene, GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH - 40, height, COLORS.panel);
    // A second, lighter border inside the ink one, like an old RPG window.
    const w = GAME_WIDTH - 44;
    const h = height - 4;
    const rim = scene.add.graphics().setPosition(GAME_WIDTH / 2 - w / 2, GAME_HEIGHT / 2 - h / 2);
    rim.fillStyle(0x8b9bb4).fillRect(0, 0, w, 2).fillRect(0, h - 2, w, 2).fillRect(0, 0, 2, h).fillRect(w - 2, 0, 2, h);
    this.container = fixToScreen(scene.add.container(0, 0, [shade, panel, rim]).setDepth(UI_DEPTH + 10));
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
  private personIcon: Phaser.GameObjects.Image;
  private mood: Phaser.GameObjects.Text;
  private face: Phaser.GameObjects.Image;
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
    this.personIcon = scene.add.image(0, 0, personIconTexture(scene));
    this.face = scene.add.image(0, 0, faceTexture(scene, 'flat'));
    this.showPopulation = showPopulation;
    const items: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth)[] = [
      scene.add.rectangle(0, 0, GAME_WIDTH, 44, COLORS.panel, 0.85).setOrigin(0),
      scene.add.rectangle(0, 44, GAME_WIDTH, 2, COLORS.ink).setOrigin(0),
      scene.add.image(22, 22, coinTexture(scene)),
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
    // The bar itself sits just under its contents (some icons were created before it).
    items[0].setDepth(UI_DEPTH - 0.5);
    items[1].setDepth(UI_DEPTH - 0.5);
    for (const o of [this.personIcon, this.population, this.face, this.mood]) o.setVisible(showPopulation);
    this.update();
  }

  update(): void {
    this.coins.setText(formatCoins(state.coins));
    const perMin = incomePerMinute();
    this.income.setX(this.coins.x + this.coins.width + 10);
    // Net of wages; a town of services can cost more than it earns.
    this.income.setText(perMin > 0 ? `+${formatRate(perMin)}/min` : perMin < 0 ? `−${formatRate(-perMin)}/min` : '');
    this.income.setColor(perMin < 0 ? '#f6757a' : '#63c74d');

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
    this.face.setTexture(faceTexture(this.face.scene, kind));
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
  const g = scene.add.image(0, 0, gearTexture(scene));
  // Generous invisible hit area so it's easy to tap.
  const hit = scene.add.rectangle(0, 0, 42, 42, 0x000000, 0.001);
  let pressed = false;
  hit.setInteractive({ useHandCursor: true });
  hit.on('pointerdown', () => {
    pressed = true;
    g.setY(2);
  });
  hit.on('pointerout', () => {
    pressed = false;
    g.setY(0);
  });
  hit.on('pointerup', () => {
    g.setY(0);
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
  const m = new Modal(scene, cheats ? 556 : 266);
  setModal(m);
  const close = () => {
    m.destroy();
    setModal(undefined);
  };
  m.text(GAME_WIDTH / 2, m.top + 34, 'Settings', 28);
  let y = m.top + 90;

  const toggle = (x: number, label: string, on: boolean, flip: () => void) => {
    const btn = makeButton(scene, x, y, 150, 44, `${label}: ${on ? 'On' : 'Off'}`, () => {
      flip();
      save();
      m.destroy();
      openSettings(scene, setModal);
    }, on ? COLORS.primary : COLORS.neutral, 17);
    m.add(btn);
  };
  toggle(GAME_WIDTH / 2 - 82, 'Sound', state.settings.sound, () => setSound(!state.settings.sound));
  toggle(GAME_WIDTH / 2 + 82, 'Music', state.settings.music, () => setMusic(!state.settings.music));
  y += 66;

  if (cheats) {
    m.text(GAME_WIDTH / 2, y, 'Playtesting', 18).setColor(COLORS.gold);
    y += 46;
    // Two tools side by side: each runs, says what it did and closes the menu.
    const pair = (items: [string, () => void, string][]) => {
      items.forEach(([label, run, msg], i) => {
        const btn = makeButton(scene, GAME_WIDTH / 2 + (i === 0 ? -82 : 82), y, 156, 44, label, () => {
          run();
          showToast(scene, msg);
          close();
        }, COLORS.neutral, 16);
        m.add(btn);
      });
      y += 58;
    };
    toggle(GAME_WIDTH / 2 - 82, 'Free', freeMode(), () => setFreeMode(!freeMode()));
    m.add(makeButton(scene, GAME_WIDTH / 2 + 82, y, 156, 44, 'Skip 1 hour', () => {
      skipTime(3600);
      close();
    }, COLORS.neutral, 16));
    y += 58;
    const grants: [string, number][] = [['+$1k', 1_000], ['+$10k', 10_000], ['+$100k', 100_000]];
    grants.forEach(([label, amount], i) => {
      const btn = makeButton(scene, GAME_WIDTH / 2 + (i - 1) * 108, y, 100, 44, label, () => {
        state.coins += amount;
        save();
      }, COLORS.buy, 16);
      m.add(btn);
    });
    y += 58;
    pair([
      ['Max town lv', devMaxTownLevel, 'Town level 10'],
      ['Unlock gear', devUnlockGear, 'All boats, rods, gear and bait'],
    ]);
    pair([
      ['Legend next', devLegendNextCast, 'A legendary waits on your next cast'],
      ['Fill barrels', devFillBarrels, 'Barrels filled'],
    ]);
    y += 8;
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
  const bg = scene.add.rectangle(GAME_WIDTH / 2, y, w, h - 6, COLORS.card, onClick ? 1 : 0.45);
  bg.setStrokeStyle(2, highlight ? COLORS.complete : COLORS.ink);
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
  const bg = makePanel(scene, 0, 0, Math.min(GAME_WIDTH - 30, label.width + 36), 38, 0x265c42);
  const toast = fixToScreen(scene.add.container(GAME_WIDTH / 2, y - 30, [bg, label]).setDepth(UI_DEPTH + 20).setAlpha(0));
  liveToasts.set(scene, [...live, toast]);
  scene.tweens.add({ targets: toast, y, alpha: 1, duration: 250, ease: 'Back.Out' });
  scene.tweens.add({ targets: toast, alpha: 0, delay: 2800, duration: 400, onComplete: () => toast.destroy() });
}

/**
 * The logbook, one page per fishing area: species you've caught (with count and price) and
 * silhouettes of the ones still missing, plus the area's legendary fish.
 */
export function openLogbook(scene: Phaser.Scene, setModal: (m: Modal | undefined) => void, page = 0, onClose?: () => void): void {
  const area = AREAS[(page + AREAS.length) % AREAS.length];
  const cellH = 62;
  const fish = regularFish(area.id);
  const rows = Math.ceil(fish.length / 2);
  const m = new Modal(scene, 330 + rows * cellH);
  setModal(m);
  const close = () => {
    m.destroy();
    setModal(undefined);
    onClose?.();
  };
  const turn = (d: number) => {
    m.destroy();
    openLogbook(scene, setModal, page + d, onClose);
  };

  m.text(GAME_WIDTH / 2, m.top + 30, 'Logbook', 26);
  const { found, total } = pageProgress(area.id);
  m.text(GAME_WIDTH / 2, m.top + 70, `${area.name}  ${found}/${total}`, 18).setColor(found === total ? COLORS.gold : '#ffffff');
  m.add(
    makeButton(scene, 62, m.top + 70, 64, 40, '‹', () => turn(-1), COLORS.neutral, 22),
    makeButton(scene, GAME_WIDTH - 62, m.top + 70, 64, 40, '›', () => turn(1), COLORS.neutral, 22),
  );

  /** One species: picture and name, or a silhouette and where it lives. */
  const cell = (f: FishType, x: number, y: number, width: number) => {
    const known = discovered(f.id);
    const img = scene.add.image(x + 30, y, `fish-${f.id}`).setScale(Math.min(1, 52 / (f.width * 1.6)));
    if (!known) img.setTint(0x0b1a2a).setTintMode(Phaser.TintModes.FILL).setAlpha(0.8);
    m.add(img);
    m.text(x + 62, y - 10, known ? f.name : '???', 15, 0).setAlpha(known ? 1 : 0.6);
    const info = known ? `×${state.caught[f.id]} · $${f.value}` : `${f.minDepth}–${f.maxDepth} m`;
    m.text(x + 62, y + 10, info, 12, 0).setAlpha(0.7).setWordWrapWidth(width - 66);
  };

  let y = m.top + 120;
  fish.forEach((f, i) => cell(f, i % 2 === 0 ? 30 : GAME_WIDTH / 2, y + Math.floor(i / 2) * cellH, GAME_WIDTH / 2 - 30));
  y += rows * cellH + 10;

  const legend = legendOf(area.id);
  if (legend) {
    const caught = discovered(legend.id);
    m.add(scene.add.rectangle(GAME_WIDTH / 2, y, GAME_WIDTH - 70, 60, 0xffd166, 0.12).setStrokeStyle(2, 0xffd166, 0.8));
    cell(legend, 40, y, GAME_WIDTH - 80);
    m.text(GAME_WIDTH - 50, y, caught ? 'Trophy unlocked!' : 'Legendary', 13, 1).setColor(COLORS.gold);
    y += 50;
  }

  const bonus = Math.round(LOGBOOK_PAGE_BONUS * 100);
  const done = pageComplete(area.id);
  m.text(GAME_WIDTH / 2, y + 12, done ? `Page complete: fish here sell for +${bonus}%` : `Complete the page: fish here sell for +${bonus}%`, 14)
    .setColor(done ? COLORS.gold : '#ffffff')
    .setAlpha(done ? 1 : 0.75);
  m.text(GAME_WIDTH / 2, y + 36, `Species found: ${speciesCount()}/${totalSpecies()}`, 13).setAlpha(0.6);
  m.add(makeButton(scene, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', close, COLORS.neutral));
}

/**
 * The barrels: every fish you're keeping, today's price for each (up or down on normal), and
 * Sell buttons per species or for everything. Price bonuses apply at the moment you sell.
 */
export function openMarket(scene: Phaser.Scene, setModal: (m: Modal | undefined) => void, page = 0, onClose?: () => void): void {
  const rowH = 46;
  const height = Math.min(GAME_HEIGHT - 110, 760);
  const perPage = Math.max(1, Math.floor((height - 290) / rowH));
  const items = stock();
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(page, pages - 1);
  const m = new Modal(scene, height);
  setModal(m);
  const close = () => {
    m.destroy();
    setModal(undefined);
    onClose?.();
  };
  const reopen = (to = p) => {
    m.destroy();
    openMarket(scene, setModal, to, onClose);
  };

  m.text(GAME_WIDTH / 2, m.top + 30, 'Barrels', 26);
  m.text(GAME_WIDTH / 2, m.top + 62, `${cratesUsed()}/${crateCapacity()} fish · worth $${formatCoins(stockValue())}`, 16).setColor(COLORS.gold);
  const bonuses = items.length > 0 ? priceBonuses(items[0][0]).filter(([name]) => name !== 'logbook') : [];
  const parts = bonuses.map(([name, v]) => `${name} +${Math.round(v * 100)}%`);
  if ((state.charms.voucher ?? 0) > 0) parts.push('voucher +50%');
  m.text(GAME_WIDTH / 2, m.top + 94, parts.length > 0 ? `Selling now: ${parts.join(', ')}` : "Prices change every day: sell what's up!", 16)
    .setAlpha(0.8)
    .setAlign('center')
    .setWordWrapWidth(GAME_WIDTH - 70);

  let y = m.top + 146;
  if (items.length === 0) m.text(GAME_WIDTH / 2, y + 20, 'Empty. Go catch something!', 16).setAlpha(0.7);
  for (const [type, n] of items.slice(p * perPage, (p + 1) * perPage)) {
    const img = scene.add.image(54, y, `fish-${type.id}`);
    m.add(img.setScale(Math.min(0.8, 48 / img.width)));
    const name = m.text(84, y, `${type.name} ×${n}`, 16, 0);
    if (type.legendary) name.setColor(COLORS.gold);
    const factor = dailyFactor(type.id);
    const trend = factor >= 1.05 ? ' ^' : factor <= 0.95 ? ' v' : '';
    m.text(GAME_WIDTH - 128, y, `$${salePrice(type)}${trend}`, 16, 1).setColor(factor >= 1.05 ? '#63c74d' : factor <= 0.95 ? '#f6757a' : '#ffffff');
    m.add(
      makeButton(scene, GAME_WIDTH - 72, y, 92, 36, `$${formatCoins(salePrice(type) * n)}`, () => {
        const coins = sellType(type);
        if (coins > 0) showToast(scene, `+$${formatCoins(coins)}`);
        reopen();
      }, COLORS.buy, 16),
    );
    y += rowH;
  }

  const footY = m.top + m.height - 92;
  if (pages > 1) {
    const prev = makeButton(scene, 62, footY, 64, 40, '<', () => p > 0 && reopen(p - 1), COLORS.neutral, 16);
    const next = makeButton(scene, GAME_WIDTH - 62, footY, 64, 40, '>', () => p < pages - 1 && reopen(p + 1), COLORS.neutral, 16);
    prev.setEnabledLook(p > 0, COLORS.neutral);
    next.setEnabledLook(p < pages - 1, COLORS.neutral);
    m.add(prev, next);
  }
  const all = makeButton(scene, GAME_WIDTH / 2, footY, 200, 44, `Sell all $${formatCoins(stockValue())}`, () => {
    const coins = sellAll();
    if (coins > 0) {
      sfx.coins();
      showToast(scene, `+$${formatCoins(coins)}`);
    }
    reopen(0);
  }, COLORS.buy, 16);
  all.setEnabledLook(items.length > 0, COLORS.buy);
  m.add(all, makeButton(scene, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', close, COLORS.neutral));
}
