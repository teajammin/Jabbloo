import { el } from './screens';

/**
 * The options menu for a placed photo.
 *
 * Hidden until you hold on the photo (or right-click it), the way Instagram
 * keeps crop options out of the way until you touch the image. Showing every
 * crop shape in the toolbar the whole time is noise: they only mean anything
 * once a photo is actually placed.
 */

export interface PhotoMenuItem {
  icon: string;
  label: string;
  onPick: () => void;
  /** Renders as a heavier confirm, or a quieter destructive action. */
  tone?: 'confirm' | 'danger';
  /** Draws a divider above this item. */
  separated?: boolean;
}

export interface PhotoMenu {
  open: (clientX: number, clientY: number) => void;
  close: () => void;
  readonly isOpen: boolean;
  destroy: () => void;
}

export function photoMenu(items: PhotoMenuItem[]): PhotoMenu {
  const menu = el('div', { class: 'photo-menu' });
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  for (const item of items) {
    const classes = ['photo-menu-item'];
    if (item.tone) classes.push(`is-${item.tone}`);
    if (item.separated) classes.push('is-separated');
    const node = el('button', { class: classes.join(' '), type: 'button' },
      el('span', { class: 'photo-menu-icon' }, item.icon),
      el('span', {}, item.label),
    );
    node.setAttribute('role', 'menuitem');
    node.addEventListener('click', () => {
      close();
      item.onPick();
    });
    menu.appendChild(node);
  }

  document.body.appendChild(menu);
  let open = false;

  function place(clientX: number, clientY: number): void {
    // Measure before clamping; the menu has no size while hidden.
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(Math.max(pad, clientX - rect.width / 2), window.innerWidth - rect.width - pad);
    // Prefer above the finger, so it is not hidden under the hand.
    const above = clientY - rect.height - 16;
    const y = above > pad ? above : Math.min(clientY + 16, window.innerHeight - rect.height - pad);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  function close(): void {
    if (!open) return;
    open = false;
    menu.hidden = true;
  }

  const onOutside = (event: PointerEvent) => {
    if (!open) return;
    if (!menu.contains(event.target as Node)) close();
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  // Capture phase, so a tap on the canvas closes the menu before it draws.
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onEscape);

  return {
    open(clientX, clientY) {
      open = true;
      place(clientX, clientY);
    },
    close,
    get isOpen() { return open; },
    destroy() {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onEscape);
      menu.remove();
    },
  };
}
