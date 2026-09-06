import { el, type Screen } from './screens';
import { countdown } from './timer';
import { bubbleText } from './bubbleText';
import type { RoomConnection } from '../net/room';
import {
  REVEAL_SECONDS, VOTE_SECONDS, battlegrounds, voters, type RoomState,
} from '../shared/protocol';
import { toCss } from '../engine/theme';

/**
 * Battleground selection.
 *
 * Everyone picks, judges included, and every pick is a ticket in the draw. The
 * screen has to make that legible: it shows who voted for what, then shuffles
 * before landing, because a draw that resolves instantly reads as the game
 * ignoring the vote.
 */
export function battlegroundScreen(connection: RoomConnection, isHost: boolean): Screen {
  return (root) => {
    const clock = countdown();
    const heading = el('div', { class: 'ground-heading' });
    const grid = el('div', { class: 'ground-grid' });
    const note = el('p', { class: 'lede' }, isHost
      ? 'Everyone is picking on their phones.'
      : 'Pick a battleground — every pick goes in the hat.');

    const cards = new Map<string, { card: HTMLElement; voters: HTMLElement }>();
    let myVote: string | null = null;
    let revealing = false;
    let shuffleTimer: number | null = null;

    for (const ground of battlegrounds) {
      const swatch = el('div', { class: 'ground-swatch' });
      swatch.style.background = toCss(ground.colour);
      const votersRow = el('div', { class: 'ground-voters' });

      const card = el('button', { class: 'ground-card', type: 'button' },
        swatch,
        el('span', { class: 'ground-name' }, ground.label),
        votersRow,
      );
      card.setAttribute('aria-label', `Pick ${ground.label}`);
      card.addEventListener('click', () => {
        if (revealing || isHost) return;
        myVote = ground.id;
        connection.send({ type: 'voteBattleground', id: ground.id });
      });

      cards.set(ground.id, { card, voters: votersRow });
      grid.appendChild(card);
    }

    /** Who picked what, so the odds are visible before the draw. */
    function renderVotes(state: RoomState): void {
      for (const [, entry] of cards) entry.voters.replaceChildren();

      for (const player of voters(state)) {
        const pick = state.votes[player.id];
        if (!pick) continue;
        const entry = cards.get(pick);
        if (!entry) continue;
        entry.voters.appendChild(
          el('span', { class: 'ground-voter' }, player.name.slice(0, 1).toUpperCase()),
        );
      }

      for (const [id, entry] of cards) {
        entry.card.setAttribute('aria-pressed', String(id === myVote));
        entry.card.classList.toggle('is-mine', id === myVote);
      }
    }

    /**
     * Cycles the highlight before settling on the winner.
     *
     * Slows as it goes, so it reads as a draw coming to rest rather than a
     * result that was decided all along.
     */
    function runShuffle(winner: string): void {
      revealing = true;
      note.textContent = 'Drawing…';
      const ids = battlegrounds.map((b) => b.id);
      let i = 0;
      let delay = 90;
      const started = Date.now();

      const spin = () => {
        for (const [id, entry] of cards) {
          entry.card.classList.toggle('is-spotlight', id === ids[i % ids.length]);
        }
        i++;
        const elapsed = Date.now() - started;
        if (elapsed > REVEAL_SECONDS * 1000 * 0.6) {
          for (const [id, entry] of cards) {
            entry.card.classList.toggle('is-spotlight', id === winner);
            entry.card.classList.toggle('is-winner', id === winner);
          }
          const ground = battlegrounds.find((b) => b.id === winner);
          note.textContent = `${ground?.label ?? 'Somewhere'} it is.`;
          heading.replaceChildren(
            bubbleText(ground?.label.toUpperCase() ?? '', { height: 72, jitter: 4 }),
          );
          return;
        }
        delay = Math.min(320, delay * 1.12);
        shuffleTimer = window.setTimeout(spin, delay);
      };
      spin();
    }

    connection.on({
      onState: (state) => {
        if (state.phase !== 'battleground') return;
        renderVotes(state);
        if (state.chosen && !revealing) {
          clock.setDeadline(0, 1);
          runShuffle(state.chosen);
        } else if (!state.chosen) {
          clock.setDeadline(state.stepEndsAt, VOTE_SECONDS);
        }
      },
    });

    heading.replaceChildren(bubbleText('WHERE', { height: 72, jitter: 4 }));

    root.append(
      el('main', { class: 'screen screen-ground' }, heading, note, clock.root, grid),
    );

    if (connection.state) renderVotes(connection.state);

    return () => {
      clock.stop();
      if (shuffleTimer !== null) clearTimeout(shuffleTimer);
    };
  };
}
