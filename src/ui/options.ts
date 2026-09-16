import { el, button } from './screens';
import { helpDialog } from './help';
import { getSettings, updateSettings, type Settings } from '../settings';
import { play, unlockAudio } from '../audio';
import { VOICES, canNarrate, narrate } from './narrator';
import { forgetRoom } from './resume';

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
    key: 'reduceMotion' | 'largeText' | 'highContrast' | 'narration',
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

  // --- commentary -----------------------------------------------------------

  /**
   * Which voice calls the fight, with a way to hear each one.
   *
   * The presets name voices to look for rather than picking from a list,
   * because what is installed differs from machine to machine — so the only
   * honest way to choose is to hear what this particular device does with it.
   * The sample is a real line from a real fight for the same reason.
   */
  const voicePicker = (): HTMLElement => {
    if (!canNarrate()) {
      return el('p', { class: 'options-hint' },
        'The fight is called by the game\u2019s own recorded voice. This browser '
        + 'has no speech of its own, so lines with players\u2019 names in them stay '
        + 'on screen rather than being read out.');
    }

    const row = el('div', { class: 'options-voices' });
    for (const choice of VOICES) {
      const picked = getSettings().voice === choice.id;
      const node = button(choice.label, () => {
        updateSettings({ voice: choice.id });
        for (const other of row.querySelectorAll('button')) {
          other.setAttribute('aria-pressed', String(other === node));
        }
        play('click');
        void narrate('Sir Bonkalot will use the Butter Sword!');
      }, 'ghost voice-option');
      node.setAttribute('aria-pressed', String(picked));
      row.appendChild(node);
    }

    return el('div', { class: 'options-voice-block' },
      row,
      el('p', { class: 'options-hint' },
        'The fight itself is called by the game\u2019s own recorded voice, the '
        + 'same on every device. These choose who reads the lines with players\u2019 '
        + 'names in them, which no recording can \u2014 tap one to hear it.'),
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
    /*
     * Forget the room first, or quitting does nothing at all.
     *
     * A tab that reloads goes back to the game it was in — which is what
     * saves somebody whose browser crashed mid-fight, and exactly wrong here:
     * quitting reloaded the page and the resume put them straight back into
     * the fight they had just left. Saying goodbye is what makes it a quit
     * rather than a refresh.
     */
    forgetRoom();
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

    el('h3', { class: 'options-heading' }, 'Commentary'),
    toggle('narration', 'Call the fight out loud',
      'The big screen narrates each move as it happens.'),
    voicePicker(),

    el('h3', { class: 'options-heading' }, 'Help'),
    button('How to play', () => { dialog.close(); help.showModal(); }, 'ghost'),

    el('h3', { class: 'options-heading' }, 'Credits'),
    el('p', { class: 'options-credits' },
      'Jabbloo — a party game where the players draw everything. ',
      'Characters, weapons and moves by whoever is holding the device. ',
      'Animation choreographed and moves judged by Claude. ',
      'Battleground photographs from Pexels, under their free licence. ',
      'Lettering, effects and stand-in artwork drawn procedurally for this game.',
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
