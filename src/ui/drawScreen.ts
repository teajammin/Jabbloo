import { el, button, type Screen } from './screens';
import { DrawCanvas } from '../draw/DrawCanvas';
import { THICKNESSES, type ToolName } from '../draw/types';

/**
 * The drawing screen.
 *
 * Built phone-first: the canvas takes the space it can get, the toolbar sits
 * under it within thumb reach, and everything is a large tap target. Pointer
 * events cover finger, stylus and mouse from one code path, so the brief's
 * "no stylus needed" requirement costs nothing extra.
 */

/** Colours offered by default. Any colour is still reachable via the picker. */
const SWATCHES = [
  '#4a4458', '#ffffff', '#f4796f', '#fbd268', '#a8de9b', '#8fb8f0',
  '#cbb2ed', '#f79bb8', '#7fcfc4', '#ffc49b', '#b5533a', '#2f7d5e',
];

export interface DrawScreenOptions {
  title?: string;
  /** Called with a transparent PNG data URL when the player is done. */
  onDone?: (png: string) => void;
}

export function drawScreen(options: DrawScreenOptions = {}): Screen {
  return (root) => {
    let tool: ToolName = 'pen';
    let colour = SWATCHES[0]!;
    let size: number = THICKNESSES[2]!;
    let filled = false;

    const stage = el('div', { class: 'draw-stage' });
    const canvas = new DrawCanvas(stage);

    // --- pointer handling --------------------------------------------------

    let drawing = false;

    const onDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      event.preventDefault();
      canvas.canvas.setPointerCapture(event.pointerId);
      drawing = true;
      canvas.beginStroke(tool, colour, size, canvas.toCanvas(event), filled);
    };

    const onMove = (event: PointerEvent) => {
      if (!drawing) return;
      event.preventDefault();
      // Coalesced events keep fast strokes smooth without flooding the model.
      const events = event.getCoalescedEvents?.() ?? [event];
      for (const e of events) canvas.extendStroke(canvas.toCanvas(e));
    };

    const onUp = (event: PointerEvent) => {
      if (!drawing) return;
      drawing = false;
      canvas.endStroke();
      if (canvas.canvas.hasPointerCapture(event.pointerId)) {
        canvas.canvas.releasePointerCapture(event.pointerId);
      }
    };

    canvas.canvas.addEventListener('pointerdown', onDown);
    canvas.canvas.addEventListener('pointermove', onMove);
    canvas.canvas.addEventListener('pointerup', onUp);
    canvas.canvas.addEventListener('pointercancel', onUp);

    // --- toolbar -----------------------------------------------------------

    const toolButtons = new Map<ToolName, HTMLButtonElement>();
    const selectTool = (next: ToolName) => {
      tool = next;
      for (const [name, node] of toolButtons) {
        node.setAttribute('aria-pressed', String(name === next));
      }
      shapeFill.hidden = !(next === 'rect' || next === 'ellipse');
    };

    const toolRow = el('div', { class: 'tool-row' });
    for (const [name, label, aria] of [
      ['pen', '✏️', 'Pen'],
      ['eraser', '🩹', 'Eraser'],
      ['fill', '🪣', 'Fill'],
      ['line', '╱', 'Line'],
      ['rect', '▭', 'Rectangle'],
      ['ellipse', '◯', 'Ellipse'],
    ] as const) {
      const node = button(label, () => selectTool(name), 'tool');
      node.setAttribute('aria-label', aria);
      node.setAttribute('aria-pressed', String(name === tool));
      toolButtons.set(name, node);
      toolRow.appendChild(node);
    }

    const shapeFill = button('Filled', () => {
      filled = !filled;
      shapeFill.setAttribute('aria-pressed', String(filled));
    }, 'tool wide');
    shapeFill.setAttribute('aria-pressed', 'false');
    shapeFill.hidden = true;
    toolRow.appendChild(shapeFill);

    // Thicknesses, shown as dots at their true relative size.
    const sizeRow = el('div', { class: 'tool-row' });
    const sizeButtons: HTMLButtonElement[] = [];
    for (const t of THICKNESSES) {
      const node = el('button', { class: 'size', type: 'button' });
      node.setAttribute('aria-label', `Brush size ${t}`);
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

    // Colours, plus a native picker for anything not on the palette.
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
      node.setAttribute('aria-pressed', String(value === colour));
      node.addEventListener('click', () => pickColour(value, node));
      swatchButtons.push(node);
      colourRow.appendChild(node);
    }

    const custom = el('input', { type: 'color', class: 'swatch custom', value: '#ff6699' });
    custom.setAttribute('aria-label', 'Pick any colour');
    custom.addEventListener('input', () => pickColour(custom.value));
    colourRow.appendChild(custom);

    // --- history -----------------------------------------------------------

    const undoButton = button('↶', () => canvas.undo(), 'tool');
    undoButton.setAttribute('aria-label', 'Undo');
    const redoButton = button('↷', () => canvas.redo(), 'tool');
    redoButton.setAttribute('aria-label', 'Redo');
    const clearButton = button('Clear', () => canvas.clear(), 'tool wide ghost');
    const doneButton = button('Done', () => options.onDone?.(canvas.toDataURL()), 'big primary');

    canvas.onChanged(() => {
      undoButton.disabled = !canvas.canUndo;
      redoButton.disabled = !canvas.canRedo;
      clearButton.disabled = canvas.isEmpty;
      doneButton.disabled = canvas.isEmpty;
    });
    undoButton.disabled = true;
    redoButton.disabled = true;
    clearButton.disabled = true;
    doneButton.disabled = true;

    root.append(
      el('main', { class: 'screen screen-draw' },
        el('p', { class: 'lede draw-title' }, options.title ?? 'Draw your character'),
        stage,
        el('div', { class: 'toolbar' },
          toolRow,
          sizeRow,
          colourRow,
          el('div', { class: 'tool-row' }, undoButton, redoButton, clearButton, doneButton),
        ),
      ),
    );

    return () => {
      canvas.canvas.removeEventListener('pointerdown', onDown);
      canvas.canvas.removeEventListener('pointermove', onMove);
      canvas.canvas.removeEventListener('pointerup', onUp);
      canvas.canvas.removeEventListener('pointercancel', onUp);
    };
  };
}
