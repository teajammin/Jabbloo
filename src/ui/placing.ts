import { el, button, type Screen, goHome } from './screens';
import { countdown } from './timer';
import { play } from '../audio';
import { setTrack } from '../music';
import type { RoomConnection } from '../net/room';
import {
  PLACE_SECONDS, creators, displayName, stillWorking,
  type Grip, type PlayerArt, type RoomState,
} from '../shared/protocol';

/**
 * Deciding how a weapon is held.
 *
 * The engine used to work this out by measuring the drawing: the long axis of
 * the ink, and whichever end was lighter taken for the handle. That is a decent
 * guess and it is still only a guess — a pistol and an axe are the same shape
 * to it, a chunky blob on a long shaft, so one of the two always came out held
 * by the wrong end and aimed at its owner.
 *
 * Asking is both more accurate and more fun. The weapon arrives as a sticker
 * with nothing behind it, the fighter is on the page underneath, and the player
 * drags one onto the other. Where they put it is where the hand goes; how they
 * turn it is where it points.
 */
export function placingScreen(connection: RoomConnection, isHost: boolean): Screen {
  return (root, go) => {
    if (isHost) setTrack('theme');

    let left = false;
    let art: PlayerArt | null = null;
    /** Which weapon is being placed, as an index into the player's weapons. */
    let index = 0;
    /** Where the one being placed currently sits. */
    let grip: Grip = { x: 0.5, y: 0.52, rotation: 0, scale: 1 };
    const placed = new Set<number>();

    const clock = countdown();
    const heading = el('h1', { class: 'creation-title' }, 'How do you hold it?');
    const subheading = el('p', { class: 'lede' }, '');
    const body = el('div', { class: 'creation-body' });
    const roster = el('ul', { class: 'roster' });

    /** Sends where this weapon ended up, and moves to the next one. */
    function commit(): void {
      connection.send({ type: 'placeWeapon', index, grip });
      placed.add(index);

      const next = (art?.weapons ?? []).findIndex((w, i) => w && !placed.has(i));
      if (next >= 0) {
        index = next;
        grip = { x: 0.5, y: 0.52, rotation: 0, scale: 1 };
        render();
        return;
      }

      // Everything placed: tell the room and wait for the rest.
      connection.send({ type: 'creationDone' });
    }

    /**
     * The stage: a fighter on the page, and a weapon to put on them.
     *
     * One pointer handler for all three gestures. Dragging anywhere on the
     * weapon moves it; the two handles on it turn and resize it. Handles rather
     * than a pinch because this is one-handed on a phone with the other hand
     * holding a drink.
     */
    function buildStage(character: string, weapon: string): HTMLElement {
      const stage = el('div', { class: 'place-stage' });
      const fighter = el('img', { class: 'place-fighter', src: character, alt: '' });
      const tool = el('div', { class: 'place-tool' },
        el('img', { class: 'place-tool-art', src: weapon, alt: '' }),
        el('span', { class: 'place-grip' }),
        el('span', { class: 'place-handle place-turn' }),
        el('span', { class: 'place-handle place-size' }),
      );
      stage.append(fighter, tool);

      const paint = () => {
        tool.style.left = `${grip.x * 100}%`;
        tool.style.top = `${grip.y * 100}%`;
        tool.style.transform =
          `translate(-50%, -50%) rotate(${grip.rotation}rad) scale(${grip.scale})`;
      };
      paint();

      let mode: 'move' | 'turn' | 'size' | null = null;
      let startGrip = grip;
      let startAngle = 0;
      let startDistance = 1;

      const centreOf = () => {
        const box = stage.getBoundingClientRect();
        return {
          x: box.left + box.width * grip.x,
          y: box.top + box.height * grip.y,
          box,
        };
      };

      const onDown = (event: PointerEvent) => {
        const target = event.target as HTMLElement;
        mode = target.classList.contains('place-turn') ? 'turn'
          : target.classList.contains('place-size') ? 'size'
            : 'move';
        startGrip = { ...grip };
        const centre = centreOf();
        startAngle = Math.atan2(event.clientY - centre.y, event.clientX - centre.x);
        startDistance = Math.max(12, Math.hypot(event.clientX - centre.x, event.clientY - centre.y));
        tool.setPointerCapture(event.pointerId);
        event.preventDefault();
      };

      const onMove = (event: PointerEvent) => {
        if (!mode) return;
        event.preventDefault();
        const { box } = centreOf();

        if (mode === 'move') {
          // Clamped a little outside the fighter, so a spear held at arm's
          // length is possible and a weapon lost off the page is not.
          grip = {
            ...grip,
            x: Math.max(-0.15, Math.min(1.15, (event.clientX - box.left) / box.width)),
            y: Math.max(-0.15, Math.min(1.15, (event.clientY - box.top) / box.height)),
          };
        } else if (mode === 'turn') {
          const centre = centreOf();
          const angle = Math.atan2(event.clientY - centre.y, event.clientX - centre.x);
          grip = { ...grip, rotation: startGrip.rotation + (angle - startAngle) };
        } else {
          const centre = centreOf();
          const distance = Math.hypot(event.clientX - centre.x, event.clientY - centre.y);
          grip = {
            ...grip,
            scale: Math.max(0.4, Math.min(2.2, startGrip.scale * (distance / startDistance))),
          };
        }
        paint();
      };

      const onUp = (event: PointerEvent) => {
        if (!mode) return;
        mode = null;
        if (tool.hasPointerCapture(event.pointerId)) tool.releasePointerCapture(event.pointerId);
        play('click');
      };

      tool.addEventListener('pointerdown', onDown);
      tool.addEventListener('pointermove', onMove);
      tool.addEventListener('pointerup', onUp);
      tool.addEventListener('pointercancel', onUp);

      return stage;
    }

    function render(): void {
      const state = connection.state;
      if (!state) return;
      renderRoster(state);

      const me = state.players.find((p) => p.id === connection.playerId);

      if (isHost || !me || me.role === 'judge' || me.role === 'unassigned') {
        heading.textContent = 'Taking up arms';
        subheading.textContent = isHost
          ? 'Everyone is deciding how they hold what they drew.'
          : 'The fighters are sorting out their grips.';
        clock.setDeadline(state.stepEndsAt, PLACE_SECONDS);
        body.replaceChildren(roster);
        return;
      }

      if (me.progress.done) {
        heading.textContent = 'Ready to fight';
        const others = stillWorking(state).filter((p) => p.id !== me.id);
        subheading.textContent = others.length === 0
          ? 'Everyone is set.'
          : `Waiting for ${others.length === 1 ? others[0]!.name : `${others.length} others`}.`;
        clock.setDeadline(state.stepEndsAt, PLACE_SECONDS);
        body.replaceChildren(
          el('p', { class: 'lede waiting' }, 'Your grip is set. The fight starts when everyone is ready.'),
          roster,
        );
        return;
      }

      clock.setDeadline(me.progress.endsAt, PLACE_SECONDS);

      const character = art?.character?.png;
      const weapon = art?.weapons[index];
      if (!character || !weapon) {
        // The artwork is still arriving. Saying so beats an empty frame.
        subheading.textContent = 'Fetching what you drew…';
        body.replaceChildren(el('p', { class: 'lede waiting' }, 'One moment.'));
        return;
      }

      const total = (art?.weapons ?? []).filter(Boolean).length;
      heading.textContent = `Where does the ${weapon.name} go?`;
      subheading.textContent = total > 1
        ? `Drag it onto ${art?.character?.name ?? 'your fighter'}. ${placed.size + 1} of ${total}.`
        : `Drag it onto ${art?.character?.name ?? 'your fighter'}.`;

      body.replaceChildren(
        buildStage(character, weapon.png),
        el('p', { class: 'place-hint' },
          'Drag to move it. The two handles turn it and resize it.'),
        el('div', { class: 'lib-actions' },
          button(placed.size + 1 < total ? 'Next weapon' : 'Ready', () => {
            play('click');
            commit();
          }, 'big primary')),
      );
    }

    function renderRoster(state: RoomState): void {
      roster.replaceChildren();
      for (const player of creators(state)) {
        roster.appendChild(el('li', { class: `player${player.progress.done ? ' is-ready' : ''}` },
          el('span', { class: 'avatar placeholder' }, player.name.slice(0, 1).toUpperCase()),
          el('span', { class: 'player-name' }, displayName(player)),
          el('span', { class: 'you' }, player.progress.done ? 'ready' : 'placing…'),
        ));
      }
    }

    /** Hands over as soon as the room has moved on. */
    function leave(state: RoomState): void {
      if (left || state.phase === 'placing') return;
      left = true;
      void (async () => {
        if (state.phase === 'battleground') {
          const { battlegroundScreen } = await import('./battleground');
          go(battlegroundScreen(connection, isHost));
        } else {
          const { battleScreen } = await import('./battle');
          go(battleScreen(connection, isHost));
        }
      })();
    }

    connection.on({
      onClosed: () => goHome(go),
      onArt: (pieces) => {
        const mine = pieces.find((entry) => entry.playerId === connection.playerId);
        if (!mine) return;
        // Pieces arrive one at a time, so they are merged rather than replaced.
        art = {
          playerId: mine.playerId,
          character: mine.character ?? art?.character ?? null,
          weapons: (() => {
            const weapons = [...(art?.weapons ?? [])];
            for (const [offset, weapon] of mine.weapons.entries()) {
              weapons[weapon.index ?? weapons.length + offset] = weapon;
            }
            return weapons;
          })(),
        };
        const first = art.weapons.findIndex((w) => w && !placed.has(art!.weapons.indexOf(w)));
        if (first >= 0 && !art.weapons[index]) index = first;
        render();
      },
      onState: (state: RoomState) => {
        if (state.phase !== 'placing') { leave(state); return; }
        render();
      },
    });

    connection.send({ type: 'requestArt' });

    root.append(
      el('main', { class: 'screen screen-creation' },
        heading, subheading, clock.root, body),
    );

    if (connection.state) render();

    return () => clock.stop();
  };
}
