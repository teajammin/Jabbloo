import { bubbleText } from './bubbleText';
import { el, button, goHome, type Screen } from './screens';
import { ROOM_CODE_LENGTH } from '../shared/protocol';
import { lobbyScreen } from './lobby';
import { MAX_PHOTO_BYTES, byteLength } from '../shared/protocol';

/** Avatars are shown small; anything larger is bytes nobody sees. */
const AVATAR_EDGE = 256;

/**
 * Join room: name, optional photo, and the code from the host's screen.
 *
 * Laid out for a phone first — this screen is almost never seen on a laptop —
 * but the same markup reflows for one.
 */
export const joinRoomScreen: Screen = (root, go) => {
  // A code in the URL (?room=ABCD) skips retyping it, for the link the host shares.
  const fromUrl = new URLSearchParams(location.search).get('room') ?? '';

  const code = el('input', {
    id: 'code',
    type: 'text',
    value: fromUrl.toUpperCase(),
    placeholder: 'ABCD',
    maxLength: ROOM_CODE_LENGTH,
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: false,
    class: 'code-input',
  });
  code.setAttribute('inputmode', 'latin');

  const name = el('input', {
    id: 'name',
    type: 'text',
    placeholder: 'Your name',
    maxLength: 16,
    autocomplete: 'nickname' as AutoFill,
  });

  const photo = el('input', { id: 'photo', type: 'file', accept: 'image/*', class: 'file' });
  const preview = el('img', { class: 'photo-preview', alt: '' });
  preview.hidden = true;

  let photoData: string | undefined;

  /**
   * Shrinks a photo to avatar size before it goes anywhere near the wire.
   *
   * A phone camera produces several megabytes, and a message over one closes
   * the connection outright — which is how attaching a photo cost a player
   * their seat: the join never arrived, and the phone reconnected as nobody.
   * It is shown 40 pixels wide, so this loses nothing.
   */
  const shrink = async (file: File): Promise<string> => {
    const bitmap = await createImageBitmap(file);
    const edge = Math.min(AVATAR_EDGE, Math.max(bitmap.width, bitmap.height));
    const scale = edge / Math.max(bitmap.width, bitmap.height);

    const scratch = document.createElement('canvas');
    scratch.width = Math.max(1, Math.round(bitmap.width * scale));
    scratch.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = scratch.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, scratch.width, scratch.height);
    bitmap.close?.();
    // JPEG, not PNG: a photo has no transparency to keep and a tenth the size.
    return scratch.toDataURL('image/jpeg', 0.82);
  };

  photo.addEventListener('change', () => {
    const file = photo.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const shrunk = await shrink(file);
        // Still too big — a photo is never worth losing the connection over.
        photoData = byteLength(shrunk) <= MAX_PHOTO_BYTES ? shrunk : undefined;
        if (!photoData) {
          error.textContent = 'That photo was too big to send — joining without it.';
          preview.hidden = true;
          return;
        }
        preview.src = photoData;
        preview.hidden = false;
      } catch {
        photoData = undefined;
        error.textContent = 'Could not read that photo — joining without it.';
      }
    })();
  });

  const error = el('p', { class: 'error' });
  error.setAttribute('role', 'alert');

  const submit = () => {
    const value = code.value.trim().toUpperCase();
    if (value.length !== ROOM_CODE_LENGTH) {
      error.textContent = `Room codes are ${ROOM_CODE_LENGTH} letters.`;
      code.focus();
      return;
    }
    if (!name.value.trim()) {
      error.textContent = 'Pick a name so your friends know who you are.';
      name.focus();
      return;
    }
    go((r, g) => lobbyScreen(value, 0, false, { name: name.value, photo: photoData })(r, g));
  };

  const form = el('form', { class: 'stack form' },
    el('label', { htmlFor: 'code' }, 'Room code'),
    code,
    el('label', { htmlFor: 'name' }, 'Name'),
    name,
    el('label', { htmlFor: 'photo', class: 'file-label' }, 'Photo (optional)'),
    photo,
    preview,
    error,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  form.append(
    el('button', { class: 'big primary', type: 'submit' }, 'Join'),
    button('Back', () => goHome(go), 'ghost'),
  );

  root.append(
    el('main', { class: 'screen' },
      bubbleText('JOIN', { height: 76, className: 'title' }),
      form,
    ),
  );
};
