import { el, button, goHome, type Screen } from './screens';
import { bubbleText } from './bubbleText';
import type { RoomConnection } from '../net/room';
import { play } from '../audio';
import {
  creators, teamDamage, winningTeam, type Player, type RoomState,
} from '../shared/protocol';

/**
 * The stats screen.
 *
 * Smash-style, per the brief: damage taken, damage given, and the hardest hit
 * each player landed, quoted with what they actually wrote — which is the part
 * people will want to read back to each other.
 */
export function resultsScreen(connection: RoomConnection, isHost: boolean): Screen {
  return (root, go) => {
    const title = el('div', { class: 'results-title' });
    const verdict = el('p', { class: 'lede' });
    const table = el('div', { class: 'results-grid' });
    const actions = el('div', { class: 'tool-row' });

    let sounded = false;

    function render(state: RoomState): void {
      const winner = winningTeam(state);
      if (!sounded) { sounded = true; play('fanfare'); }
      const names = state.teamNames;

      title.replaceChildren(
        bubbleText(winner ? 'WINNER' : 'A TIE', { height: 84, jitter: 5 }),
      );
      // A tie only reaches this screen once no more ULTs are owed — the room
      // goes back to the drawing board rather than here while one is. So the
      // copy has to read as a final answer, not a promise of another round.
      verdict.textContent = winner
        ? `${winner === 'teamA' ? names.teamA : names.teamB} took the least damage.`
        : state.ultRound > 0
          ? `Still level after ${state.ultRound} ULT${state.ultRound === 1 ? '' : 's'} — it stands as a tie.`
          : 'Level on damage — the game is a tie.';

      table.replaceChildren();
      for (const team of ['teamA', 'teamB'] as const) {
        const roster = creators(state).filter((p) => p.role === team);
        if (roster.length === 0) continue;

        table.appendChild(
          el('div', { class: `results-team${winner === team ? ' is-winner' : ''}` },
            el('h2', { class: 'results-team-name' },
              team === 'teamA' ? names.teamA : names.teamB),
            el('p', { class: 'results-total' }, `${teamDamage(state, team)} taken`),
            ...roster.map(playerCard),
          ),
        );
      }
    }

    function playerCard(player: Player): HTMLElement {
      const best = player.best;
      return el('div', { class: 'results-player' },
        el('p', { class: 'results-name' }, player.characterName || player.name),
        el('div', { class: 'results-numbers' },
          el('span', {}, `${player.damageTaken} taken`),
          el('span', {}, `${player.damageDealt} given`),
        ),
        best && best.damage > 0
          ? el('p', { class: 'results-best' },
              `Best: ${best.weapon} for ${best.damage}`,
              best.prompt ? el('span', { class: 'results-quote' }, `“${best.prompt}”`) : el('span', {}),
            )
          : el('p', { class: 'results-best' }, 'Landed nothing worth quoting.'),
      );
    }

    const leave = () => {
      connection.close();
      goHome(go);
    };

    /**
     * What each device offers when the fight is over.
     *
     * The host drives the room; everyone else decides for themselves. A player
     * is never dragged into the next game by someone else pressing a button —
     * they are told it has started and can follow or go home.
     */
    function showActions(state: RoomState): void {
      actions.replaceChildren();

      if (isHost) {
        actions.append(
          button('Rematch', () => connection.send({ type: 'rematch' }), 'big primary'),
          button('New game', () => connection.send({ type: 'newGame' }), 'big'),
          button('Back to menu', () => {
            connection.send({ type: 'closeRoom' });
            leave();
          }, 'big ghost'),
        );
        return;
      }

      // A player waiting for the host to choose.
      if (state.phase === 'results') {
        actions.append(
          el('p', { class: 'lede' }, 'The host is choosing what happens next.'),
          button('Back to menu', leave, 'big ghost'),
        );
        return;
      }

      actions.append(
        el('p', { class: 'lede' }, state.phase === 'creating'
          ? 'A new game has started.'
          : 'The next fight is being set up.'),
        button('Join', () => {
          void import('./creation').then(({ creationScreen }) => {
            void import('./battleground').then(({ battlegroundScreen }) => {
              go(state.phase === 'creating'
                ? creationScreen(connection, false)
                : battlegroundScreen(connection, false));
            });
          });
        }, 'big primary'),
        button('Back to menu', leave, 'big ghost'),
      );
    }

    root.append(
      el('main', { class: 'screen screen-results' }, title, verdict, table, actions),
    );

    connection.on({
      onClosed: leave,
      onState: (state) => {
        if (state.phase === 'results') {
          render(state);
          showActions(state);
          return;
        }

        // The host has moved the room on. The host's own screen follows
        // immediately — it is the one driving — while a player is offered the
        // choice rather than being pulled out of the results they are reading.
        if (!isHost) {
          showActions(state);
          return;
        }

        void import('./battleground').then(({ battlegroundScreen }) => {
          void import('./creation').then(({ creationScreen }) => {
            go(state.phase === 'creating'
              ? creationScreen(connection, true)
              : battlegroundScreen(connection, true));
          });
        });
      },
    });

    if (connection.state) {
      render(connection.state);
      showActions(connection.state);
    }
  };
}
