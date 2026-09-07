import { el, button } from './screens';
import {
  MAX_SCORE, type RoomState, type Turn,
} from '../shared/protocol';
import type { RoomConnection } from '../net/room';

/**
 * The judge's scoring panel.
 *
 * Built as a panel rather than a screen, so it can drop into the waiting view
 * a judge already has and disappear again between turns without the screen
 * being torn down and rebuilt.
 *
 * A slider rather than buttons, per the brief. It starts in the middle: a
 * default of zero would tempt a judge to leave it, and a default of 33 the
 * same, where the middle costs the same effort in either direction.
 */
export interface JudgePanel {
  root: HTMLElement;
  update: (state: RoomState) => void;
}

export function judgePanel(connection: RoomConnection): JudgePanel {
  const root = el('div', { class: 'judge-panel' });
  root.hidden = true;

  let renderedFor = '';

  function build(turn: Turn, state: RoomState): void {
    root.replaceChildren();
    root.append(el('h2', { class: 'creation-title' }, 'Score the moves'));

    for (const attackerId of turn.fighters) {
      const player = state.players.find((p) => p.id === attackerId);
      const move = turn.moves[attackerId];
      if (!player) continue;

      const weapon = player.weaponNames[move?.weapon ?? 0] || 'their weapon';
      const said = move?.prompt?.trim();

      const value = el('span', { class: 'judge-value' }, '17');
      const slider = el('input', {
        type: 'range', class: 'judge-slider',
        min: '0', max: String(MAX_SCORE), value: '17', step: '1',
      });
      slider.setAttribute('aria-label', `Score for ${player.characterName || player.name}`);

      const send = button('Lock it in', () => {
        connection.send({
          type: 'submitScore',
          attackerId,
          score: Number(slider.value),
        });
        send.disabled = true;
        send.textContent = `Scored ${slider.value}`;
        slider.disabled = true;
      }, 'big primary');

      slider.addEventListener('input', () => { value.textContent = slider.value; });

      root.append(
        el('div', { class: 'judge-move' },
          el('p', { class: 'move-sentence' },
            `${player.characterName || player.name} used the ${weapon}`),
          el('p', { class: 'lede' }, said ? `"${said}"` : 'They said nothing at all.'),
          el('div', { class: 'judge-row' }, slider, value, el('span', { class: 'lede' }, `/ ${MAX_SCORE}`)),
          send,
        ),
      );
    }
  }

  return {
    root,
    update(state) {
      const turn = state.turn;
      // Only judges score. The server already refuses a fighter's score, but
      // showing them the panel would let them lock one in and watch it count
      // for nothing — a rejection they never see is worse than no panel.
      const me = state.players.find((p) => p.id === connection.playerId);
      const judging = Boolean(turn && turn.phase === 'judging' && me?.role === 'judge');
      root.hidden = !judging;
      if (!turn || !judging) return;

      // Rebuild only when the turn changes, or a slider being dragged would
      // snap back every time another judge scored.
      const key = turn.fighters.join('-') + Object.keys(turn.moves).length;
      if (key === renderedFor) return;
      renderedFor = key;
      build(turn, state);
    },
  };
}
