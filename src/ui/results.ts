import { el, button, goHome, type Screen } from './screens';
import { bubbleText } from './bubbleText';
import type { RoomConnection } from '../net/room';
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

    function render(state: RoomState): void {
      const winner = winningTeam(state);
      const names = state.teamNames;

      title.replaceChildren(
        bubbleText(winner ? 'WINNER' : 'A TIE', { height: 84, jitter: 5 }),
      );
      verdict.textContent = winner
        ? `${winner === 'teamA' ? names.teamA : names.teamB} took the least damage.`
        : 'Level on damage — another weapon is owed as an ULT.';

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

    if (isHost) {
      actions.append(
        button('Rematch', () => connection.send({ type: 'rematch' }), 'big primary'),
        button('Back to menu', () => {
          connection.close();
          goHome(go);
        }, 'big ghost'),
      );
    } else {
      actions.append(el('p', { class: 'lede' }, 'The host decides what happens next.'));
    }

    root.append(
      el('main', { class: 'screen screen-results' }, title, verdict, table, actions),
    );

    connection.on({
      onState: (state) => {
        if (state.phase === 'results') { render(state); return; }
        // The host chose a rematch; everyone follows the room back.
        if (state.phase === 'battleground') {
          void import('./battleground').then(({ battlegroundScreen }) => {
            go(battlegroundScreen(connection, isHost));
          });
        }
      },
    });

    if (connection.state) render(connection.state);
  };
}
