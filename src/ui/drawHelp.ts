import { el } from './screens';

/**
 * What every control does, in one place.
 *
 * A `title` tooltip only exists on a device with a pointer, so on a phone the
 * toolbar is a row of unexplained emoji. This table feeds both: the tooltip on
 * hover, and a help sheet reachable by tapping.
 */
export interface ControlHelp {
  icon: string;
  name: string;
  what: string;
  /** Keyboard shortcut, where there is one. */
  key?: string;
}

export const CONTROL_HELP: Record<string, ControlHelp> = {
  select: { icon: '⬚', name: 'Select', what: 'Drag a box around part of your drawing to copy or move it.', key: 'V' },
  pen: { icon: '✏️', name: 'Pen', what: 'Draw freehand. Press harder with a stylus for a thicker line.', key: 'B' },
  eraser: { icon: '🧽', name: 'Eraser', what: 'Rub things out. It erases to transparent, not to white.', key: 'E' },
  fill: { icon: '🪣', name: 'Fill', what: 'Tap an area to flood it with the current colour.', key: 'G' },
  line: { icon: '╱', name: 'Line', what: 'Drag to draw a straight line.', key: 'L' },
  rect: { icon: '▭', name: 'Rectangle', what: 'Drag to draw a box.', key: 'R' },
  ellipse: { icon: '◯', name: 'Ellipse', what: 'Drag to draw a circle or oval.', key: 'O' },
  filled: { icon: 'Filled', name: 'Filled shapes', what: 'Switches shapes between outline and solid.' },

  upload: { icon: '🖼️', name: 'Add a photo', what: 'Bring in a picture from your camera or library. Five per drawing.' },
  cutout: { icon: '✂️', name: 'Photo options', what: 'Hold a placed photo (or right-click it) to resize, crop, cut out its background, place it or throw it away.' },
  resize: { icon: '⬚', name: 'Resize and crop', what: 'Corners resize the photo and keep its shape. Edges trim that side away.' },
  smaller: { icon: '－', name: 'Shrink', what: 'Makes the photo you are placing smaller.' },
  bigger: { icon: '＋', name: 'Enlarge', what: 'Makes the photo you are placing bigger.' },

  undo: { icon: '←', name: 'Undo', what: 'Takes back the last thing you did.', key: '⌘Z' },
  redo: { icon: '→', name: 'Redo', what: 'Puts back what you just undid.', key: '⇧⌘Z' },
  copy: { icon: '⧉', name: 'Copy', what: 'Copies whatever you have selected.', key: '⌘C' },
  paste: { icon: '📋', name: 'Paste', what: 'Drops your copy down. Drag it where you want it.', key: '⌘V' },
  clear: { icon: 'Clear', name: 'Start over', what: 'Wipes the whole drawing. Undo brings it back.' },
  done: { icon: 'Done', name: 'Finished', what: 'Saves your drawing and moves on.' },
};

/** The help sheet: every control, its icon, and what it does. */
export function drawHelpDialog(): HTMLDialogElement {
  const dialog = el('dialog', { class: 'help draw-help' });

  const close = el('button', { class: 'help-close', type: 'button' }, '×');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => dialog.close());

  const list = el('ul', { class: 'help-controls' });
  for (const item of Object.values(CONTROL_HELP)) {
    list.appendChild(
      el('li', {},
        el('span', { class: 'help-icon' }, item.icon),
        el('span', { class: 'help-text' },
          el('strong', {}, item.name),
          el('span', {}, item.what),
        ),
        item.key ? el('kbd', {}, item.key) : el('span', {}),
      ),
    );
  }

  dialog.append(
    close,
    el('h2', {}, 'What the buttons do'),
    list,
    el('p', { class: 'help-note' },
      'Hold your finger on a shape to copy it, then drag the copy where you want it.'),
  );

  return dialog;
}
