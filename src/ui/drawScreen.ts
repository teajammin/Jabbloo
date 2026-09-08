import { el, button, type Screen } from './screens';
import { DrawCanvas } from '../draw/DrawCanvas';
import { THICKNESSES, type ToolName } from '../draw/types';
import {
  MAX_UPLOADS, cropImage, importFile, maskImage, placeOnCanvas, type MaskShape,
} from '../draw/images';
import { CONTROL_HELP, drawHelpDialog } from './drawHelp';
import { MAX_ARTWORK_BYTES, byteLength } from '../shared/protocol';
import { photoMenu } from './photoMenu';

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
  /**
   * Handed a way to read the drawing at any moment.
   *
   * Creation runs on a clock, and a player who is still drawing when it runs
   * out has never pressed Done — so without this their work never leaves the
   * phone and they fight as a nameless bean holding a stand-in sword.
   */
  onSnapshot?: (read: () => string | null) => void;
  /**
   * Rendered inside another screen rather than as one.
   *
   * Nesting a <main> inside a <main> is invalid and leaves a screen reader
   * with two competing landmarks, so an embedded tool is a <section>.
   */
  embedded?: boolean;
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

    /**
     * A tooltip that follows the pointer.
     *
     * The native `title` only appears after a delay, in the corner of the
     * element, and never on a phone. This shows immediately beside the cursor,
     * and the same text is what a press-and-hold prints on touch.
     */
    const tip = el('div', { class: 'tool-tip' });
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');

    const showTip = (text: string, x: number, y: number) => {
      tip.textContent = text;
      tip.hidden = false;
      const rect = tip.getBoundingClientRect();
      const pad = 8;
      tip.style.left = `${Math.min(Math.max(pad, x + 14), window.innerWidth - rect.width - pad)}px`;
      tip.style.top = `${Math.max(pad, y - rect.height - 12)}px`;
    };
    const hideTip = () => { tip.hidden = true; };

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
      const description = help.key
        ? `${help.name} (${help.key}) — ${help.what}`
        : `${help.name} — ${help.what}`;

      // Only on devices with a real pointer: on touch a hover tooltip would
      // flash on every tap, and press-and-hold covers it instead.
      if (window.matchMedia('(hover: hover)').matches) {
        node.addEventListener('pointerenter', (e) => showTip(description, e.clientX, e.clientY));
        node.addEventListener('pointermove', (e) => showTip(description, e.clientX, e.clientY));
        node.addEventListener('pointerleave', hideTip);
        node.addEventListener('click', hideTip);
      }

      let held = false;
      let timer: number | null = null;
      const stop = () => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };

      let pressAt: { x: number; y: number } | null = null;
      node.addEventListener('pointerdown', (event) => {
        held = false;
        pressAt = { x: event.clientX, y: event.clientY };
        timer = window.setTimeout(() => {
          held = true;
          say(`${help.name} — ${help.what}`);
          navigator.vibrate?.(12);
        }, 450);
      });
      // A toolbar row scrolls sideways, and that scroll starts as a press on a
      // button — without this the description fires mid-swipe.
      node.addEventListener('pointermove', (event) => {
        if (!pressAt) return;
        if (Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > 8) stop();
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

    const HOLD_MS = 550;
    // Tight on purpose: any real movement means a drag, not a hold.
    const HOLD_SLOP = 6;
    let holdTimer: number | null = null;
    let holdStart: { x: number; y: number } | null = null;

    const cancelHold = () => {
      if (holdTimer !== null) { window.clearTimeout(holdTimer); holdTimer = null; }
      holdStart = null;
    };

    /**
     * Hold to select the thing under your finger.
     *
     * It used to copy and paste in one go, which meant any slow, careful
     * stroke that stayed still for half a second silently dropped a duplicate
     * of the drawing on top of itself. Selecting is what a hold should do;
     * copying is what the ⧉ button is for.
     */
    const grabSubject = (at: { x: number; y: number; p: number }) => {
      canvas.abortStroke();
      drawing = false;
      if (!canvas.selectSubjectAt(at)) {
        say('Nothing there — hold on something you have drawn');
        return;
      }
      say('Selected — ⧉ copies it, 📋 pastes the copy');
      navigator.vibrate?.(18);
    };

    /** True while a crop handle is being dragged, so drawing stays suppressed. */
    let croppingDrag = false;
    /** True while a placed photo is being moved or scaled. */
    let transformDrag = false;

    /**
     * Pinch to zoom, on a canvas the size of a hand.
     *
     * A 1024px drawing shown at phone width is a third of its own resolution,
     * which is fine for a body and hopeless for an eye. Zooming is a CSS
     * transform on the stage rather than anything the canvas knows about:
     * pointer coordinates are worked out from the element's own bounding box,
     * and a transform changes that box, so drawing keeps landing in the right
     * place at any magnification with no arithmetic of its own.
     */
    const MAX_ZOOM = 4;
    /** Only shown when there is something to go back from. */
    const zoomOutButton = button('⤢', () => resetZoom(), 'tool zoom-out');
    zoomOutButton.setAttribute('aria-label', 'Fit to screen');
    zoomOutButton.title = 'Fit to screen';
    zoomOutButton.hidden = true;

    const pointers = new Map<number, { x: number; y: number }>();
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    /** The pinch in progress: what the gesture started from. */
    let pinch: { distance: number; zoom: number; x: number; y: number;
      panX: number; panY: number } | null = null;

    function applyZoom(): void {
      // Held inside its own frame: panned far enough that the drawing left the
      // screen, there would be nothing to pinch back.
      const limit = (stage.clientWidth * (zoom - 1)) / 2;
      panX = Math.max(-limit, Math.min(limit, panX));
      panY = Math.max(-limit, Math.min(limit, panY));
      stage.style.transform = zoom === 1 && panX === 0 && panY === 0
        ? ''
        : `translate(${panX}px, ${panY}px) scale(${zoom})`;
      zoomOutButton.hidden = zoom === 1;
    }

    function resetZoom(): void {
      zoom = 1;
      panX = 0;
      panY = 0;
      applyZoom();
      say('Back to fit');
    }

    const midpoint = () => {
      const [a, b] = [...pointers.values()];
      return a && b
        ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
        : null;
    };

    const onDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // A second finger is a pinch, never a second stroke. Whatever the first
      // finger had started is abandoned rather than left half-drawn.
      if (pointers.size === 2) {
        cancelHold();
        canvas.abortStroke();
        drawing = false;
        croppingDrag = false;
        transformDrag = false;
        const centre = midpoint();
        if (centre) {
          pinch = { distance: centre.distance, zoom, x: centre.x, y: centre.y, panX, panY };
        }
        return;
      }

      if (!event.isPrimary) return;
      // Right and middle buttons must not draw, drag or place anything: the
      // context menu handles them, and pointerdown fires first.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      surface.setPointerCapture(event.pointerId);
      const at = canvas.toCanvas(event);

      if (canvas.isCropping) {
        const handle = canvas.cropHandleAt(at);
        if (handle) {
          canvas.beginCropDrag(handle, at);
          croppingDrag = true;
        }
        return;
      }

      // A placed photo is a modal thing: touching it moves or scales it,
      // whichever tool is selected. Touching away from it places it and
      // carries on drawing, which is what tapping elsewhere already meant.
      if (canvas.hasFloating) {
        const handle = canvas.transformHandleAt(at);
        if (handle) {
          canvas.beginTransformDrag(handle, at);
          transformDrag = true;
          holdStart = { x: event.clientX, y: event.clientY };
          const { clientX, clientY } = event;
          holdTimer = window.setTimeout(() => {
            holdTimer = null;
            canvas.endTransformDrag();
            transformDrag = false;
            menu.open(clientX, clientY);
            navigator.vibrate?.(14);
          }, HOLD_MS);
          return;
        }
        canvas.commitFloating();
        say('Photo placed');
      }

      // A placed photo can be picked back up and moved or resized, but only
      // with the select tool — otherwise there would be no way to draw on top
      // of one.
      if (tool === 'select' && !canvas.hasFloating && canvas.liftImageAt(at)) {
        canvas.beginTransformDrag(canvas.transformHandleAt(at) ?? 'move', at);
        transformDrag = true;
        say('Drag to move · corners resize · hold for options');

        // Holding on it opens the same options right-click gives a laptop.
        holdStart = { x: event.clientX, y: event.clientY };
        const { clientX, clientY } = event;
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          canvas.endTransformDrag();
          transformDrag = false;
          menu.open(clientX, clientY);
          navigator.vibrate?.(14);
        }, HOLD_MS);
        return;
      }

      drawing = true;
      canvas.beginStroke(tool, colour, size, at, filled);

      // Hold-to-select belongs to the select tool. Bound to the pen it fired
      // mid-stroke on any slow, careful line.
      if (tool !== 'select') return;
      holdStart = { x: event.clientX, y: event.clientY };
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        grabSubject(at);
      }, HOLD_MS);
    };

    const onMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pinch) {
        event.preventDefault();
        const centre = midpoint();
        if (!centre || pinch.distance === 0) return;
        zoom = Math.max(1, Math.min(MAX_ZOOM, pinch.zoom * (centre.distance / pinch.distance)));
        // The pinch moves the drawing as well as scaling it, so two fingers
        // can carry the canvas to the corner they want to work on.
        panX = pinch.panX + (centre.x - pinch.x);
        panY = pinch.panY + (centre.y - pinch.y);
        applyZoom();
        return;
      }

      if (croppingDrag) {
        event.preventDefault();
        canvas.dragCrop(canvas.toCanvas(event));
        return;
      }
      if (transformDrag) {
        event.preventDefault();
        if (holdStart && Math.hypot(
          event.clientX - holdStart.x, event.clientY - holdStart.y,
        ) > HOLD_SLOP) {
          cancelHold();
        }
        canvas.dragTransform(canvas.toCanvas(event));
        return;
      }
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
      pointers.delete(event.pointerId);
      if (pinch && pointers.size < 2) {
        pinch = null;
        // The finger still down would otherwise start a stroke from wherever
        // the pinch left it.
        canvas.abortStroke();
        drawing = false;
        return;
      }

      cancelHold();
      if (croppingDrag || transformDrag) {
        croppingDrag = false;
        transformDrag = false;
        canvas.endCropDrag();
        canvas.endTransformDrag();
        if (surface.hasPointerCapture(event.pointerId)) {
          surface.releasePointerCapture(event.pointerId);
        }
        return;
      }
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

    // Right-click is the desktop equivalent of the hold.
    const onContext = (event: MouseEvent) => {
      if (!canvas.hasFloating) return;
      const at = canvas.toCanvas(event as unknown as PointerEvent);
      if (!canvas.isOverFloating(at)) return;
      event.preventDefault();
      menu.open(event.clientX, event.clientY);
    };
    surface.addEventListener('contextmenu', onContext);

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

    // A rainbow well rather than a swatch showing the current colour: it has to
    // read as "any colour", not as one more preset.
    const custom = el('input', { type: 'color', class: 'sr-only', value: '#ff6699' });
    custom.setAttribute('aria-label', 'Pick any colour');
    const customWell = el('label', { class: 'swatch rainbow' }, custom);
    customWell.title = 'Pick any colour';
    if (window.matchMedia('(hover: hover)').matches) {
      customWell.addEventListener('pointerenter', (e) => showTip('Pick any colour', e.clientX, e.clientY));
      customWell.addEventListener('pointermove', (e) => showTip('Pick any colour', e.clientX, e.clientY));
      customWell.addEventListener('pointerleave', hideTip);
    }
    custom.addEventListener('input', () => pickColour(custom.value));
    colourRow.appendChild(customWell);

    // --- photos ------------------------------------------------------------

    // One at a time: a multi-select picker plus a repeatable button reads as
    // two different ways to do the same thing.
    const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'sr-only' });

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
        say(`Drag to move · corners resize · ${MAX_UPLOADS - uploadsUsed} photos left`);

        // On touch there is no right-click to discover, so the options open
        // themselves the first time a photo lands.
        if (!window.matchMedia('(hover: hover)').matches) {
          const rect = surface.getBoundingClientRect();
          menu.open(rect.left + rect.width / 2, rect.top + rect.height * 0.42);
        }
      } catch {
        say('Could not read that image');
      }
    });

    const uploadButton = control('upload', () => fileInput.click());
    const biggerButton = control('bigger', () => canvas.scaleFloating(1.15));
    const smallerButton = control('smaller', () => canvas.scaleFloating(1 / 1.15));

    // --- photo options menu ------------------------------------------------
    //
    // Crop shapes only mean anything once a photo is placed, so they live on
    // the photo rather than in the toolbar: hold it, or right-click it.

    const shape = (key: MaskShape) => async () => {
      const layer = canvas.floatingLayer;
      if (!layer) return;
      say('Cutting the shape…');
      try {
        canvas.replaceFloating(await maskImage(layer.data, key));
        say('Shaped — drag it into place, then pick another tool to keep it');
      } catch {
        say('Could not cut that shape');
      }
    };

    const menu = photoMenu([
      {
        // Trimming by hand, rather than a model guessing what the subject is.
        // Placing the photo first is the whole point: once it is part of the
        // drawing the eraser cuts into it like anything else, and the player
        // decides what counts as background.
        icon: '🧽', label: 'Rub bits out', onPick: () => {
          canvas.commitFloating();
          selectTool('eraser');
          updateCropBar();
          say('Rub away whatever you do not want — ← undoes it');
        },
      },
      {
        icon: '⬚', label: 'Resize and crop', onPick: () => {
          if (!canvas.beginCrop()) return;
          updateCropBar();
          say('Corners resize the photo · edges trim it · ✓ keeps it, ✕ cancels');
        },
      },
      { icon: '⭕', label: 'Crop to a circle', onPick: shape('circle') },
      { icon: '🔺', label: 'Crop to a triangle', onPick: shape('triangle') },
      { icon: '⭐', label: 'Crop to a star', onPick: shape('star') },
      { icon: '💗', label: 'Crop to a heart', onPick: shape('heart') },
      {
        icon: '✓', label: 'Place it here', tone: 'confirm', separated: true,
        onPick: () => {
          menu.close();
          canvas.commitFloating();
          say('Photo placed — ← undoes it');
        },
      },
      {
        icon: '↩︎', label: 'Undo last change', onPick: () => {
          canvas.undo();
          say('Undone');
        },
      },
      {
        icon: '🗑️', label: 'Throw the photo away', tone: 'danger', onPick: () => {
          canvas.cancelFloating();
          say('Photo removed');
        },
      },
    ]);

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

    /**
     * Exports the drawing at the largest size that will fit down the wire.
     *
     * A message over a megabyte does not fail — the platform closes the socket
     * carrying it — so a drawing with a photo in it could cost a player their
     * connection and their character at once. Fighters are drawn a few hundred
     * pixels tall, so stepping the export down costs nothing anyone can see.
     */
    const exportDrawing = (): string => {
      let png = canvas.toDataURL();
      for (const edge of [768, 640, 512, 384]) {
        if (byteLength(png) <= MAX_ARTWORK_BYTES) break;
        png = canvas.toDataURL(edge);
      }
      return png;
    };

    const doneButton = control('done', () => options.onDone?.(exportDrawing()), 'tool wide primary');

    // Nothing is exported until asked for, so this costs nothing until the
    // clock or a locking screen calls it.
    options.onSnapshot?.(() => (canvas.isEmpty ? null : exportDrawing()));

    // Only visible while a crop frame is up: on a phone there is no Enter key
    // to confirm with, so the confirm has to be on screen.
    const applyCropButton = button('✓ Keep', async () => {
      if (canvas.isCropping) {
        const done = await canvas.applyCrop(cropImage);
        updateCropBar();
        say(done ? 'Cropped — drag it into place, then ✓ again to place it' : 'Nothing to crop');
        return;
      }
      canvas.commitFloating();
      updateCropBar();
      say('Photo placed — ← undoes it');
    }, 'tool wide primary');

    const cancelCropButton = button('✕', () => {
      if (canvas.isCropping) {
        canvas.cancelCrop();
        say('Crop cancelled');
      } else {
        canvas.cancelFloating();
        say('Photo removed');
      }
      updateCropBar();
    }, 'tool wide ghost');
    cancelCropButton.setAttribute('aria-label', 'Cancel');

    const cropBar = el('div', { class: 'tool-row crop-bar' }, cancelCropButton, applyCropButton);

    /**
     * The confirm bar covers a floating photo as well as a crop frame.
     *
     * A photo is placed at 80% of the canvas, so it can cover nearly all of it
     * — leaving nowhere to tap "outside" to place it. Without an always-visible
     * confirm, a player could be stuck with a photo they cannot put down.
     */
    function updateCropBar(): void {
      const active = canvas.isCropping || canvas.hasFloating;
      cropBar.hidden = !active;
      applyCropButton.textContent = canvas.isCropping ? '✓ Keep crop' : '✓ Place photo';
      applyCropButton.setAttribute(
        'aria-label', canvas.isCropping ? 'Keep this crop' : 'Place the photo',
      );
    }
    cropBar.hidden = true;

    const helpDialog = drawHelpDialog();
    const helpButton = button('?', () => helpDialog.showModal(), 'tool');
    helpButton.setAttribute('aria-label', 'What the buttons do');
    helpButton.title = 'What the buttons do';

    canvas.onChanged(() => {
      updateCropBar();
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
      if (key === 'enter') {
        if (canvas.isCropping) {
          void canvas.applyCrop(cropImage).then(() => {
            updateCropBar();
            say('Cropped — drag it into place');
          });
          return;
        }
        canvas.commitFloating();
        return;
      }
      if (key === 'escape') {
        // The menu owns Escape while it is open, or one press would dismiss
        // the menu and throw away the photo behind it.
        if (menu.isOpen) return;
        if (canvas.isCropping) { canvas.cancelCrop(); updateCropBar(); return; }
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

    const shell = options.embedded
      ? el('section', { class: 'screen screen-draw is-embedded' })
      : el('main', { class: 'screen screen-draw' });

    shell.append(
      el('p', { class: 'lede draw-title' }, options.title ?? 'Draw your character'),
      area,
      zoomOutButton,
        el('div', { class: 'toolbar' },
          toolRow,
          sizeRow,
          colourRow,
          el('div', { class: 'tool-row' },
            uploadButton, smallerButton, biggerButton,
            undoButton, redoButton, copyButton, pasteButton),
          cropBar,
          // Marked as the actions row so it can be pinned: on a laptop the
          // toolbar is a column that can outgrow the window, and Done was
          // scrolling off the bottom of it.
          el('div', { class: 'tool-row actions' }, helpButton, clearButton, doneButton),
          fileInput,
          status,
        ),
    );

    root.append(shell, helpDialog, tip);

    return () => {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onUp);
      surface.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
      menu.destroy();
      cancelHold();
    };
  };
}
