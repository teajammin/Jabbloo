import { el, button } from './screens';
import { helpDialog } from './help';
import { getSettings, updateSettings, type Settings } from '../settings';
import { play, unlockAudio } from '../audio';

/**
 * The options menu, reachable from every screen.
 *
 * Mounted on <body> by the entry point rather than by a screen, because the
 * brief wants it available at all times and screens are torn down and rebuilt
 * constantly — a menu owned by one of them would blink in and out of
 * existence as the game moved on.
 *
 * A <dialog> for the same reason help is: focus trapping, Escape to close and
 * inertness behind it come free and correct.
 */
export function mountOptions(): () => void {
  const help = helpDialog();
  const dialog = el('dialog', { class: 'options' });

  const close = el('button', { class: 'help-close', type: 'button' }, '×');
  close.setAttribute('aria-label', 'Close options');
  close.addEventListener('click', () => dialog.close());

  // --- accessibility --------------------------------------------------------

  const toggle = (
    key: 'reduceMotion' | 'largeText' | 'highContrast',
    label: string,
    hint: string,
  ): HTMLElement => {
    const input = el('input', { type: 'checkbox', checked: getSettings()[key] });
    input.addEventListener('change', () => {
      updateSettings({ [key]: input.checked } as Partial<Settings>);
      play('click');
    });
    return el('label', { class: 'options-row' },
      input,
      el('span', { class: 'options-label' },
        el('strong', {}, label),
        el('small', {}, hint),
      ),
    );
  };

  // --- audio ----------------------------------------------------------------

  const slider = (key: 'music' | 'sfx', label: string): HTMLElement => {
    const input = el('input', {
      type: 'range', min: '0', max: '100', step: '5',
      value: String(Math.round(getSettings()[key] * 100)),
      class: 'options-slider',
    });
    const readout = el('span', { class: 'options-value' }, `${input.value}%`);
    input.addEventListener('input', () => {
      readout.textContent = `${input.value}%`;
      updateSettings({ [key]: Number(input.value) / 100 } as Partial<Settings>);
    });
    // Previewed on release rather than while dragging, or setting the volume
    // would fire a cue for every pixel of travel.
    input.addEventListener('change', () => { unlockAudio(); play('hit'); });
    return el('label', { class: 'options-row' },
      el('span', { class: 'options-label' }, el('strong', {}, label)),
      input,
      readout,
    );
  };

  // --- quit -----------------------------------------------------------------

  const quit = button('Quit to menu', () => {
    if (!confirm('Leave the game and go back to the menu?')) return;
    // A reload rather than a navigation: it closes the room socket, drops the
    // Pixi stage and clears every screen's listeners in one step, which is
    // exactly what quitting should mean.
    location.href = location.pathname;
  }, 'big ghost');

  dialog.append(
    close,
    el('h2', {}, 'Options'),

    el('h3', { class: 'options-heading' }, 'Accessibility'),
    toggle('reduceMotion', 'Reduce motion', 'Shorter, calmer animations.'),
    toggle('largeText', 'Larger text', 'Scales the whole interface up.'),
    toggle('highContrast', 'High contrast', 'Stronger outlines, plainer colours.'),

    el('h3', { class: 'options-heading' }, 'Audio'),
    slider('sfx', 'Effects'),
    slider('music', 'Music'),

    el('h3', { class: 'options-heading' }, 'Help'),
    button('How to play', () => { dialog.close(); help.showModal(); }, 'ghost'),

    el('h3', { class: 'options-heading' }, 'Credits'),
    el('p', { class: 'options-credits' },
      'Jabbloo — a party game where the players draw everything. ',
      'Characters, weapons and moves by whoever is holding the phone. ',
      'Animation choreographed and moves judged by Claude.',
    ),

    el('div', { class: 'tool-row' }, quit),
  );

  const open = button('⚙', () => {
    unlockAudio();
    play('click');
    dialog.showModal();
  }, 'options-open');
  open.setAttribute('aria-label', 'Options');
  open.title = 'Options';

  document.body.append(open, dialog, help);

  return () => {
    open.remove();
    dialog.remove();
    help.remove();
  };
}
