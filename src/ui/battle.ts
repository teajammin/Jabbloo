import { el, type Screen } from './screens';
import type { RoomConnection } from '../net/room';
import { moveScreen } from './move';
import {
  creators, type BattlegroundId, type PlayerArt, type RoomState,
} from '../shared/protocol';

/**
 * The battle stage.
 *
 * The fight is drawn on the host screen only, per the brief — phones are
 * controllers. The engine is loaded lazily here rather than imported at the
 * top: Pixi is over half a megabyte, and a phone that only ever shows a
 * prompt box should never download it.
 */
export function battleScreen(connection: RoomConnection, isHost: boolean): Screen {
  return (root, go) => {
    let disposed = false;
    let teardownStage: (() => void) | null = null;

    if (!isHost) {
      const waiting = el('main', { class: 'screen' },
        el('h1', { class: 'creation-title' }, 'Watch the big screen'),
        el('p', { class: 'lede' }, 'Your turn will appear here when it comes.'),
      );
      root.append(waiting);

      let showingMove = false;
      connection.on({
        onState: (state) => {
          const turn = state.turn;
          const me = state.players.find((p) => p.id === connection.playerId);
          const mine = Boolean(turn && me && turn.fighters.includes(me.id));

          // Swap in only on the way into a turn, so a state update mid-typing
          // never rebuilds the screen and wipes what has been written.
          if (mine && turn?.phase === 'picking' && !showingMove && me) {
            showingMove = true;
            const weapons = (me.weaponNames.length
              ? me.weaponNames
              : ['Sword', 'Axe', 'Hammer']
            ).map((name) => ({ name: name || 'Weapon' }));
            go(moveScreen(connection, weapons, me.characterName || me.name));
          }
        },
      });
      return;
    }

    const stage = el('div', { class: 'battle-stage' });
    const status = el('p', { class: 'lede' }, 'Bringing the fighters in…');
    root.append(el('main', { class: 'screen screen-battle' }, stage, status));

    /**
     * Builds the stage once the artwork arrives.
     *
     * Everything is awaited before anything is shown: a fighter appearing a
     * frame before their weapon reads as a bug, and the grand entrance the
     * brief asks for only works if both are ready.
     */
    async function build(art: PlayerArt[], state: RoomState): Promise<void> {
      const { BattleStage, Fighter, preloadEffects } = await import('../engine');
      if (disposed) return;

      const ground = (state.chosen ?? 'meadow') as BattlegroundId;
      const battle = new BattleStage({ parent: stage, battleground: ground });
      await preloadEffects();
      if (disposed) { battle.destroy(); return; }

      // One fighter from each side, which is what the stage shows at a time.
      const roster = creators(state);
      const sides = ['teamA', 'teamB'] as const;
      const chosen = sides.map((team) => {
        const player = roster.find((p) => p.role === team);
        return player ? art.find((a) => a.playerId === player.id) ?? null : null;
      });

      const built = await Promise.all(chosen.map(async (entry, index) => {
        if (!entry?.character) return null;
        const weapon = entry.weapons[0];
        return Fighter.create({
          name: entry.character.name,
          character: entry.character.png,
          ...(weapon
            ? { weapon: weapon.png, weaponName: weapon.name }
            // A player who ran out of time still fights; the brief gives them
            // a standard weapon rather than leaving them empty-handed.
            : { weapon: '/placeholder-weapon-sword.png', weaponName: 'Sword' }),
          facing: index === 0 ? 'right' : 'left',
        });
      }));

      if (disposed) { battle.destroy(); return; }

      built.forEach((fighter, index) => {
        if (fighter) battle.addFighter(fighter, index === 0 ? 'left' : 'right');
      });

      const names = built.map((f) => f?.name ?? '—');
      status.textContent = `${names[0]} versus ${names[1]}`;

      teardownStage = () => battle.destroy();
    }

    let art: PlayerArt[] | null = null;
    let state: RoomState | null = connection.state;

    const tryBuild = () => {
      if (art && state && !teardownStage) void build(art, state);
    };

    connection.on({
      onArt: (next) => { art = next; tryBuild(); },
      onState: (next) => { state = next; tryBuild(); },
    });

    // The host pulls the artwork; it is far too large to broadcast.
    connection.send({ type: 'requestArt' });

    return () => {
      disposed = true;
      teardownStage?.();
    };
  };
}
