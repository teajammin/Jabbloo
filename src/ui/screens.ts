/**
 * A minimal screen manager.
 *
 * Screens are plain functions that build a DOM subtree and return an optional
 * teardown. No framework: the game is a handful of screens plus one Pixi
 * canvas, and a router would be more machinery than the problem needs.
 */

import { play, unlockAudio } from '../audio';

export type Teardown = () => void;
export type Screen = (root: HTMLElement, go: Navigate) => Teardown | void;
export type Navigate = (screen: Screen) => void;

/**
 * How long a screen may spend arriving before it is shown regardless.
 *
 * Long enough for images already in the cache and for a slow first fetch;
 * short enough that a picture which is never coming cannot strand anybody on
 * an empty page.
 */
const READY_TIMEOUT = 1800;

export function mount(root: HTMLElement): Navigate {
  let teardown: Teardown | void;
  /** Rising number, so a slow screen cannot reveal itself after a faster one. */
  let generation = 0;

  const go: Navigate = (screen) => {
    const mine = ++generation;

    teardown?.();
    root.replaceChildren();

    /*
     * Built out of sight, shown once it is whole.
     *
     * Screens were mounted straight into the page, so the room watched them
     * assemble: a heading, then a line of text, then pictures arriving one at
     * a time as the network returned them. A page putting itself together in
     * front of an audience looks broken even when it is working perfectly.
     *
     * So the new screen is built hidden over a plain background, its images
     * are waited for, and it appears in one piece. `visibility` rather than
     * `display`, because a screen with no layout cannot measure itself — the
     * drawing canvas sizes from the space it is given and would come up
     * zero — and hidden elements still lay out.
     */
    root.classList.add('is-arriving');
    teardown = screen(root, go);

    const reveal = (): void => {
      // A newer screen has already started; this one lost its turn.
      if (mine !== generation) return;
      root.classList.remove('is-arriving');
      // Move focus to the new screen so keyboard and screen-reader users are
      // not stranded on a button that no longer exists.
      const focusable = root.querySelector<HTMLElement>('[autofocus], button, input');
      focusable?.focus();
    };

    void whenPicturesLand(root).then(() => {
      // One frame, so the browser has laid the page out before it is seen.
      requestAnimationFrame(reveal);
    });
    setTimeout(reveal, READY_TIMEOUT);
  };

  return go;
}

/**
 * Resolves once every image already in a subtree has loaded, or failed.
 *
 * Images added later — a photograph a player uploads, a card built after a
 * server message — are not waited for: this is about the screen arriving
 * whole, not about it never changing again.
 */
function whenPicturesLand(root: HTMLElement): Promise<unknown> {
  const pictures = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  if (pictures.length === 0) return Promise.resolve();

  return Promise.all(pictures.map((img) => new Promise<void>((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  })));
}

/**
 * The screen to return to from a Back button.
 *
 * Registered by the entry point rather than imported directly: the launch
 * screen imports create/join, so those importing it back would be a cycle.
 */
let home: Screen | null = null;

export function setHome(screen: Screen): void {
  home = screen;
}

export function goHome(go: Navigate): void {
  if (home) go(home);
}

// ------------------------------------------------------------------- helpers

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) node.className = className;
  Object.assign(node, rest);
  node.append(...children);
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  className = '',
): HTMLButtonElement {
  const node = el('button', { class: className, type: 'button' }, label);
  node.addEventListener('click', () => {
    // Every button is a gesture, which is the only moment a browser will let
    // audio start — so unlocking here means the first click is also audible.
    unlockAudio();
    play('click');
    onClick();
  });
  return node;
}
