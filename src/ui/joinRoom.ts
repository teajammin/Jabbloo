import { bubbleText } from './bubbleText';
import { el, button, goHome, type Screen } from './screens';
import { ROOM_CODE_LENGTH } from '../shared/protocol';
import { lobbyScreen } from './lobby';

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
  photo.addEventListener('change', () => {
    const file = photo.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      photoData = String(reader.result);
      preview.src = photoData;
      preview.hidden = false;
    });
    reader.readAsDataURL(file);
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
