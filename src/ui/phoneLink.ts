import { el, button } from './screens';

/**
 * "Open this on your phone" — the address, as a QR code.
 *
 * A laptop browser only knows the name it was opened under, and on the host
 * that is usually localhost: the one address on a network that means a
 * different machine to every device that reads it. The dev server can see the
 * machine's real address, so it is asked, and the answer is shown as something
 * a camera can read rather than something a player has to type.
 *
 * Deployed, there is no such endpoint and the page's own address is already
 * right, so the same dialog works with no special case.
 */

export interface PhoneLink {
  dialog: HTMLDialogElement;
  open: () => void;
}

export function phoneLink(path = '/'): PhoneLink {
  const dialog = el('dialog', { class: 'options phone-link' });

  const close = el('button', { class: 'help-close', type: 'button' }, '×');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => dialog.close());

  const address = el('p', { class: 'join-url' }, location.host);
  const qr = el('img', { class: 'join-qr', alt: '' });
  qr.hidden = true;
  const note = el('p', { class: 'lede' }, 'Both devices must be on the same wifi.');

  let resolved = false;

  async function resolve(): Promise<void> {
    if (resolved) return;
    resolved = true;

    let host = location.host;
    try {
      const response = await fetch('/api/lan');
      const body = response.ok ? await response.json() as { hosts?: string[] } : {};
      if (body.hosts?.[0]) host = body.hosts[0];
    } catch {
      // Deployed, or no backend: the page's own address stands.
    }

    address.textContent = host;
    const url = `${location.protocol}//${host}${path}`;
    try {
      const { toDataURL } = await import('qrcode');
      qr.src = await toDataURL(url, {
        margin: 1, width: 240, color: { dark: '#4a4458', light: '#fffdf7' },
      });
      qr.alt = `Scan to open ${url}`;
      qr.hidden = false;
    } catch {
      // No QR, but the address above is still typeable.
    }
  }

  dialog.append(
    close,
    el('h2', {}, 'Play on your phone'),
    el('p', { class: 'lede' }, 'Point your camera at this, or type the address in.'),
    qr,
    address,
    note,
  );

  return {
    dialog,
    open: () => { void resolve(); dialog.showModal(); },
  };
}

/** The button that opens it. */
export function phoneLinkButton(link: PhoneLink): HTMLButtonElement {
  const node = button('📱 Play on your phone', () => link.open(), 'big ghost');
  node.setAttribute('aria-label', 'Show a QR code for joining from a phone');
  return node;
}
