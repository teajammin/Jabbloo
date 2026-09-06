import { el, button, type Screen } from './screens';
import { DrawCanvas } from '../draw/DrawCanvas';
import { THICKNESSES, type ToolName } from '../draw/types';
import {
  MAX_UPLOADS, cropImage, cutSubject, importFile, maskImage, placeOnCanvas,
  type MaskShape,
} from '../draw/images';
import { CONTROL_HELP, drawHelpDialog } from './drawHelp';

/**
 * The drawing screen.
 *
 * Phone-first: the canvas takes whatever height the toolbar leaves, controls
 * are large tap targets, and pointer events cover finger, stylus and mouse from
 * one path — so the brief's "no stylus needed" costs nothing extra.
 *
 * Every control carries its label three ways, because a phone has none of the
 * usual affordances: an aria-label for screen readers, a `title` for hover on a
 * desktop, and a press-and-hold that prints the description into the status
 * line for touch. The ? sheet lists them all.
 */

const SWATCHES = [
  '#4a4458', '#ffffff', '#f4796f', '#fbd268', '#a8de9b', '#8fb8f0',
  '#cbb2ed', '#f79bb8', '#7fcfc4', '#ffc49b', '#b5533a', '#2f7d5e',
];

export interface DrawScreenOptions {
  title?: string;
  onDone?: (png: string) => void;
}

export function drawScreen(options: DrawScreenOptions = {}): Screen {
  return (root) => {
    let tool: ToolName = 'pen';
    let colour = SWATCHES[0]!;
    let size: number = THICKNESSES[2]!;
    let filled = false;
    let uploadsUsed = 0;

    // The stage sits in its own centring wrapper. A square that has to fit
    // both a width and a height cannot size itself as a flex item directly.
    const area = el('div', { class: 'draw-area' });
    const stage = el('div', { class: 'draw-stage' });
    area.appendChild(stage);
    const canvas = new DrawCanvas(stage);
    const surface = canvas.surface;

    const status = el('p', { class: 'draw-hint' });
    status.setAttribute('role', 'status');
    const say = (message: string) => { status.textContent = message; };
    say('Hold on a shape to copy it · tap ? if you get stuck');

    // --- control factory ---------------------------------------------------

    /**
     * Builds a labelled control.
     *
     * Press-and-hold prints the description rather than firing the action, so
     * a phone user can find out what an emoji means without triggering it.
     */
    function control(
      helpKey: keyof typeof CONTROL_HELP,
      onClick: () => void,
      className = 'tool',
    ): HTMLButtonElement {
      const help = CONTROL_HELP[helpKey]!;
      const node = button(help.icon, () => {}, className);
      node.setAttribute('aria-label', help.name);
      node.title = help.key ? `${help.name} (${help.key}) — ${help.what}` : `${help.name} — ${help.what}`;

      let held = false;
      let timer: number | null = null;
      const stop = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

      node.addEventListener('pointerdown', () => {
        held = false;
        timer = window.setTimeout(() => {
          held = true;
          say(`${help.name} — ${help.what}`);
          navigator.vibrate?.(12);
        }, 450);
      });
      node.addEventListener('pointerup', stop);
      node.addEventListener('pointerleave', stop);
      node.addEventListener('pointercancel', stop);
      node.addEventListener('click', () => {
        stop();
        // A hold explained the button; it should not also press it.
        if (held) { held = false; return; }
        onClick();
      });

      return node;
    }

    // --- pointer handling --------------------------------------------------

    let drawing = false;

    const HOLD_MS = 500;
    const HOLD_SLOP = 10;
    let holdTimer: number | null = null;
    let holdStart: { x: number; y: number } | null = null;

    const cancelHold = () => {
      if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
      holdStart = null;
    };

    const grabSubject = (at: { x: number; y: number; p: number }) => {
      canvas.abortStroke();
      drawing = false;
      if (!canvas.selectSubjectAt(at)) {
        say('Nothing to grab there — hold on something you have drawn');
        return;
      }
      canvas.copy();
      canvas.paste();
      selectTool('select');
      say('Copied — drag it where you want, then press Done or pick another tool');
      navigator.vibrate?.(18);
    };

    const onDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      event.preventDefault();
      surface.setPointerCapture(event.pointerId);
      drawing = true;
      const at = canvas.toCanvas(event);
      canvas.beginStroke(tool, colour, size, at, filled);

      // Not while something is floating: positioning a paste means holding
      // still, which would otherwise re-trigger the grab and replace it.
      if (!canvas.hasFloating) {
        holdStart = { x: event.clientX, y: event.clientY };
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          grabSubject(at);
        }, HOLD_MS);
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!drawing) return;
      event.preventDefault();
      if (holdStart && Math.hypot(
        event.clientX - holdStart.x, event.clientY - holdStart.y,
      ) > HOLD_SLOP) {
        cancelHold();
      }
      const events = event.getCoalescedEvents?.() ?? [event];
      for (const e of events) canvas.extendStroke(canvas.toCanvas(e));
    };

    const onUp = (event: PointerEvent) => {
      cancelHold();
      // Release capture even when the hold already ended the stroke, or the
      // surface keeps it until the next pointerdown.
      if (surface.hasPointerCapture(event.pointerId)) {
        surface.releasePointerCapture(event.pointerId);
      }
      if (!drawing) return;
      drawing = false;
      canvas.endStroke();
      if (tool === 'select' && canvas.hasSelection) {
        say('Selected — tap ⧉ to copy it');
      }
    };

    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onUp);

    // --- tools -------------------------------------------------------------

    const toolButtons = new Map<ToolName, HTMLButtonElement>();
    const selectTool = (next: ToolName) => {
      tool = next;
      for (const [name, node] of toolButtons) {
        node.setAttribute('aria-pressed', String(name === next));
      }
      shapeFill.hidden = !(next === 'rect' || next === 'ellipse');
    };

    const toolRow = el('div', { class: 'tool-row' });
    for (const name of ['select', 'pen', 'eraser', 'fill', 'line', 'rect', 'ellipse'] as const) {
      const node = control(name, () => selectTool(name));
      node.setAttribute('aria-pressed', String(name === tool));
      toolButtons.set(name, node);
      toolRow.appendChild(node);
    }

    const shapeFill = control('filled', () => {
      filled = !filled;
      shapeFill.setAttribute('aria-pressed', String(filled));
      say(filled ? 'Shapes are solid' : 'Shapes are outlines');
    }, 'tool wide');
    shapeFill.setAttribute('aria-pressed', 'false');
    shapeFill.hidden = true;
    toolRow.appendChild(shapeFill);

    // --- sizes and colours -------------------------------------------------

    const sizeRow = el('div', { class: 'tool-row' });
    const sizeButtons: HTMLButtonElement[] = [];
    for (const t of THICKNESSES) {
      const node = el('button', { class: 'size', type: 'button' });
      node.setAttribute('aria-label', `Brush size ${t}`);
      node.title = `Brush size ${t}`;
      node.setAttribute('aria-pressed', String(t === size));
      const dot = el('span', { class: 'size-dot' });
      dot.style.width = `${Math.max(4, t * 0.55)}px`;
      dot.style.height = `${Math.max(4, t * 0.55)}px`;
      node.appendChild(dot);
      node.addEventListener('click', () => {
        size = t;
        for (const other of sizeButtons) {
          other.setAttribute('aria-pressed', String(other === node));
        }
      });
      sizeButtons.push(node);
      sizeRow.appendChild(node);
    }

    const colourRow = el('div', { class: 'tool-row' });
    const swatchButtons: HTMLButtonElement[] = [];
    const pickColour = (next: string, node?: HTMLElement) => {
      colour = next;
      for (const other of swatchButtons) {
        other.setAttribute('aria-pressed', String(other === node));
      }
    };
    for (const value of SWATCHES) {
      const node = el('button', { class: 'swatch', type: 'button' });
      node.style.background = value;
      node.setAttribute('aria-label', `Colour ${value}`);
      node.title = `Colour ${value}`;
      node.setAttribute('aria-pressed', String(value === colour));
      node.addEventListener('click', () => pickColour(value, node));
      swatchButtons.push(node);
      colourRow.appendChild(node);
    }

    const custom = el('input', { type: 'color', class: 'swatch custom', value: '#ff6699' });
    custom.setAttribute('aria-label', 'Pick any colour');
    custom.title = 'Pick any colour';
    custom.addEventListener('input', () => pickColour(custom.value));
    colourRow.appendChild(custom);

    // --- photos ------------------------------------------------------------

    // One at a time: a multi-select picker plus a repeatable button reads as
    // two different ways to do the same thing.
    const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'sr-only' });

    const uploadButton = control('upload', () => fileInput.click());

    // Deliberately never disabled: a greyed-out button with no explanation is
    // what made this one unreadable. It now says what it needs instead.
    const cutoutButton = control('cutout', async () => {
      const layer = canvas.floatingLayer;
      if (!layer) { say('Add a photo with 🖼️ first, then ✂️ removes its background'); return; }
      cutoutButton.disabled = true;
      say('Cutting out…');
      try {
        const cut = await cutSubject({ data: layer.data, w: layer.w, h: layer.h });
        canvas.replaceFloating(cut.data);
        say('Cut out — drag it into place, then pick another tool to keep it');
      } catch {
        say('Could not cut that one out');
      } finally {
        cutoutButton.disabled = !canvas.hasFloating;
      }
    });
    const biggerButton = control('bigger', () => canvas.scaleFloating(1.15));
    const smallerButton = control('smaller', () => canvas.scaleFloating(1 / 1.15));

    // --- cropping ----------------------------------------------------------

    const cropButton = control('crop', async () => {
      if (!canvas.hasFloating) { say('Add a photo with 🖼️ first'); return; }
      if (!canvas.hasSelection) {
        selectTool('select');
        say('Drag a box over the photo, then tap ⬚✂ again to trim it');
        return;
      }
      const cropped = await canvas.cropFloatingToSelection(cropImage);
      say(cropped ? 'Trimmed — drag it into place' : 'Draw the box over the photo');
    });

    const shapeButton = (key: MaskShape) => control(key, async () => {
      const layer = canvas.floatingLayer;
      if (!layer) { say('Add a photo with 🖼️ first, then pick a shape'); return; }
      say('Cutting the shape…');
      try {
        canvas.replaceFloating(await maskImage(layer.data, key));
        say('Shaped — drag it into place, then pick another tool to keep it');
      } catch {
        say('Could not cut that shape');
      }
    });
    const circleButton = shapeButton('circle');
    const triangleButton = shapeButton('triangle');
    const starButton = shapeButton('star');
    const heartButton = shapeButton('heart');

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (uploadsUsed >= MAX_UPLOADS) {
        say(`That's all ${MAX_UPLOADS} photos`);
        return;
      }
      say('Loading photo…');
      try {
        const image = await importFile(file);
        const spot = placeOnCanvas(image);
        canvas.placeImage(image.data, spot.x, spot.y, spot.w, spot.h);
        uploadsUsed++;
        selectTool('select');
        say(`Drag it into place · ✂️ removes the background · ${MAX_UPLOADS - uploadsUsed} photos left`);
      } catch {
        say('Could not read that image');
      }
    });

    // --- history and clipboard ---------------------------------------------

    const undoButton = control('undo', () => canvas.undo());
    const redoButton = control('redo', () => canvas.redo());

    // Copy on its own leaves nothing on screen, which reads as a dead button.
    // It now says what happened and points at the next step.
    const copyButton = control('copy', () => {
      canvas.copy();
      say('Copied — tap 📋 to place a copy');
    });
    const pasteButton = control('paste', () => {
      canvas.paste();
      selectTool('select');
      say('Drag the copy where you want it, then pick another tool to keep it');
    });

    const clearButton = control('clear', () => {
      canvas.clear();
      say('Cleared — ↶ brings it back');
    }, 'tool wide ghost');

    const doneButton = control('done', () => options.onDone?.(canvas.toDataURL()), 'tool wide primary');

    const helpDialog = drawHelpDialog();
    const helpButton = button('?', () => helpDialog.showModal(), 'tool');
    helpButton.setAttribute('aria-label', 'What the buttons do');
    helpButton.title = 'What the buttons do';

    canvas.onChanged(() => {
      undoButton.disabled = !canvas.canUndo;
      redoButton.disabled = !canvas.canRedo;
      clearButton.disabled = canvas.isEmpty;
      doneButton.disabled = canvas.isEmpty;
      copyButton.disabled = !canvas.hasSelection;
      pasteButton.disabled = !canvas.hasClipboard;
      biggerButton.disabled = !canvas.hasFloating;
      smallerButton.disabled = !canvas.hasFloating;
      uploadButton.disabled = uploadsUsed >= MAX_UPLOADS;
    });
    for (const node of [undoButton, redoButton, clearButton, doneButton, copyButton,
      pasteButton, biggerButton, smallerButton]) {
      node.disabled = true;
    }

    // --- keyboard ----------------------------------------------------------

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') {
        event.preventDefault();
        event.shiftKey ? canvas.redo() : canvas.undo();
        return;
      }
      if (mod && key === 'y') { event.preventDefault(); canvas.redo(); return; }
      if (mod && key === 'c') {
        event.preventDefault();
        canvas.copy();
        say('Copied — ⌘V to place a copy');
        return;
      }
      if (mod && key === 'x') { event.preventDefault(); canvas.cut(); say('Cut'); return; }
      if (mod && key === 'v') {
        event.preventDefault();
        canvas.paste();
        selectTool('select');
        say('Drag the copy into place, then Enter');
        return;
      }
      if (mod && key === 'a') {
        event.preventDefault();
        canvas.selectAll();
        selectTool('select');
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        if (!canvas.hasSelection) return;
        event.preventDefault();
        canvas.deleteSelection();
        return;
      }
      if (key === 'enter') { canvas.commitFloating(); return; }
      if (key === 'escape') {
        canvas.hasFloating ? canvas.cancelFloating() : canvas.clearSelection();
        return;
      }

      const shortcuts: Record<string, ToolName> = {
        v: 'select', b: 'pen', e: 'eraser', g: 'fill',
        l: 'line', r: 'rect', o: 'ellipse',
      };
      if (!mod && shortcuts[key]) {
        event.preventDefault();
        selectTool(shortcuts[key]!);
      }
    };
    window.addEventListener('keydown', onKey);

    root.append(
      el('main', { class: 'screen screen-draw' },
        el('p', { class: 'lede draw-title' }, options.title ?? 'Draw your character'),
        area,
        el('div', { class: 'toolbar' },
          toolRow,
          sizeRow,
          colourRow,
          el('div', { class: 'tool-row' },
            uploadButton, cutoutButton, cropButton, smallerButton, biggerButton),
          el('div', { class: 'tool-row' },
            circleButton, triangleButton, starButton, heartButton),
          el('div', { class: 'tool-row' },
            undoButton, redoButton, copyButton, pasteButton),
          el('div', { class: 'tool-row' }, helpButton, clearButton, doneButton),
          fileInput,
          status,
        ),
      ),
      helpDialog,
    );

    return () => {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      cancelHold();
    };
  };
}
