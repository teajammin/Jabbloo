/**
 * A minimal screen manager.
 *
 * Screens are plain functions that build a DOM subtree and return an optional
 * teardown. No framework: the game is a handful of screens plus one Pixi
 * canvas, and a router would be more machinery than the problem needs.
 */

export type Teardown = () => void;
export type Screen = (root: HTMLElement, go: Navigate) => Teardown | void;
export type Navigate = (screen: Screen) => void;

export function mount(root: HTMLElement): Navigate {
  let teardown: Teardown | void;

  const go: Navigate = (screen) => {
    teardown?.();
    root.replaceChildren();
    teardown = screen(root, go);
    // Move focus to the new screen so keyboard and screen-reader users are not
    // stranded on a button that no longer exists.
    const focusable = root.querySelector<HTMLElement>('[autofocus], button, input');
    focusable?.focus();
  };

  return go;
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
  node.addEventListener('click', onClick);
  return node;
}
