import { el, button, type Screen, goHome } from './screens';
import { countdown } from './timer';
import { play } from '../audio';
import { suggestionsFor } from '../shared/suggestions';
import type { RoomConnection } from '../net/room';
import {
  MAX_PROMPT_WORDS, MOVE_SECONDS, isFinalRound, wordCount, SIDES, guardsFor, attacksFor,
  type RoomState, type Side, type WeaponKind,
} from '../shared/protocol';

/**
 * An arrow per side, so the grid reads without its labels.
 *
 * On a phone the words are small and the layout is doing most of the work;
 * the arrow is what makes "top" obvious at a glance while holding the thing
 * in one hand.
 */
const SIDE_MARKS: Record<Side, string> = {
  top: '\u2191',
  bottom: '\u2193',
  left: '\u2190',
  right: '\u2192',
};

/**
 * The move screen, on a fighter's phone.
 *
 * The brief's shape: pick a weapon, then finish the sentence
 * "<character> will use the <weapon> by …" in up to fifty words. Naming the
 * weapon in the sentence is what makes the limit feel like a prompt rather
 * than a form field.
 */
export function moveScreen(
  connection: RoomConnection,
  weapons: { name: string; kind?: WeaponKind }[],
  characterName: string,
): Screen {
  return (root, go) => {
    /*
     * Which suggestions this turn gets.
     *
     * From the turn number rather than the clock, so every phone in the room
     * is offered the same few and they become something to talk about — and
     * so a player who reloads does not get a different set and wonder where
     * the one they were reading went.
     */
    const turnSeed = connection.state?.turn?.index ?? 0;

    let weapon = 0;
    let left = false;
    let submitted = false;

    /**
     * Where to guard, and where to aim.
     *
     * Both are chosen before either player sees anything, which is the whole
     * of the game here: a guard that catches the blow halves it, and neither
     * side has anything to go on but the other one's habits.
     */
    let defend: Side[] = ['left'];
    let attack: Side[] = ['right'];

    const clock = countdown();
    const heading = el('h1', { class: 'creation-title' }, 'Your turn');
    const stakes = el('p', { class: 'move-stakes' }, '');
    const sentence = el('p', { class: 'move-sentence' });
    const status = el('p', { class: 'lede' }, '');

    const weaponRow = el('div', { class: 'tool-row weapon-row' });
    const weaponButtons: HTMLButtonElement[] = [];

    const prompt = el('textarea', {
      class: 'move-prompt', rows: 4,
      placeholder: 'swinging it overhead and slamming it down like a thunderbolt',
    });
    prompt.setAttribute('maxlength', '400');

    const counter = el('span', { class: 'move-count' }, `0 / ${MAX_PROMPT_WORDS}`);
    const send = button('Attack', () => submit(), 'big primary');

    /**
     * One ring of four sides, carrying both choices at once.
     *
     * It was two separate grids, which made guarding and striking look like two
     * unrelated questions and left no way at all to say "I am guarding the side
     * I am also striking" — a legal and often sensible move the interface could
     * not express. One ring solves both: a side holds either role, or both, and
     * a side holding both is drawn as one sticker split corner to corner.
     *
     * Arranged around an empty middle rather than listed, so "top" is above and
     * "left" is to the left: the choice is a place on a body, not a word off a
     * list, which is what it has to feel like to be worth guessing about.
     */
    function sideRing(
      onChange: () => void,
    ): { root: HTMLElement; paint: () => void } {
      const buttons = new Map<Side, HTMLButtonElement>();
      const grid = el('div', { class: 'side-grid' });

      const paint = () => {
        for (const [side, node] of buttons) {
          const guarding = defend.includes(side);
          const striking = attack.includes(side);
          node.classList.toggle('is-guard', guarding && !striking);
          node.classList.toggle('is-strike', striking && !guarding);
          node.classList.toggle('is-both', guarding && striking);
          node.setAttribute('aria-pressed', String(guarding || striking));
          /*
           * Said in words as well as in colour.
           *
           * Green and red are the pair most often indistinguishable, and this
           * is the one control where getting it wrong costs a player the round.
           */
          const roles = [guarding && 'guarding', striking && 'striking']
            .filter(Boolean).join(' and ');
          node.setAttribute('aria-label', roles ? `${side}, ${roles}` : side);
          const dots = node.querySelector('.side-roles');
          if (dots) {
            dots.replaceChildren(
              ...(guarding ? [el('i', { class: 'r-guard' })] : []),
              ...(striking ? [el('i', { class: 'r-strike' })] : []),
            );
          }
        }
        onChange();
      };

      for (const side of SIDES) {
        const node = el('button', { class: `side-pick sticker side-${side}`, type: 'button' },
          el('span', { class: 'side-mark' }, SIDE_MARKS[side]),
          el('span', { class: 'side-word' }, side),
          el('span', { class: 'side-roles' }));

        /*
         * One tap cycles the roles this side holds.
         *
         * Two separate grids needed two taps in two places to express one
         * intention. Cycling keeps it to one target: nothing, guard, strike,
         * both, and round again — and each step is refused rather than allowed
         * when the weapon has no capacity left for it, so the interface never
         * promises a block the server will not honour.
         */
        node.addEventListener('click', () => {
          const kind = weapons[weapon]?.kind ?? 'offensive';
          const guards = guardsFor(kind);
          const strikes = attacksFor(kind);
          const guarding = defend.includes(side);
          const striking = attack.includes(side);

          if (!guarding && !striking) {
            defend = [...defend, side].slice(-guards);
          } else if (guarding && !striking) {
            defend = defend.filter((s) => s !== side);
            attack = [...attack, side].slice(-strikes);
          } else if (striking && !guarding) {
            defend = [...defend, side].slice(-guards);
          } else {
            defend = defend.filter((s) => s !== side);
            attack = attack.filter((s) => s !== side);
          }

          // A weapon always covers and strikes the number of places it was
          // chosen for; cycling a side off tops the rest back up.
          defend = fit(defend, guards);
          attack = fit(attack, strikes);
          paint();
          play('click');
        });

        buttons.set(side, node);
        grid.appendChild(node);
      }

      grid.appendChild(el('span', { class: 'side-centre' }, 'you'));
      return { root: grid, paint };
    }

    const ringNote = el('p', { class: 'side-note' });
    const ring = sideRing(() => { /* the note is rewritten by refreshGuards */ });

    /** Fills a choice out to the number of sides the weapon allows. */
    function fit(chosen: Side[], allowed: number): Side[] {
      const next = chosen.slice(-allowed);
      for (const side of SIDES) {
        if (next.length >= allowed) break;
        if (!next.includes(side)) next.push(side);
      }
      return next;
    }

    /**
     * Re-reads the chosen weapon.
     *
     * A shield guards two sides and strikes one; a sword strikes two and
     * guards one. Both numbers move together when the weapon changes, and
     * leaving a stale one on screen would promise something the server is not
     * going to honour.
     */
    function refreshGuards(): void {
      const kind = weapons[weapon]?.kind ?? 'offensive';
      const guards = guardsFor(kind);
      const attacks = attacksFor(kind);

      defend = fit(defend, guards);
      attack = fit(attack, attacks);
      ring.paint();

      ringNote.textContent = attacks > 1
        ? `Strike ${attacks} sides, guard ${guards}. Tap a side to cycle it: guard, strike, both.`
        : `Strike ${attacks} side, guard ${guards}. Tap a side to cycle it: guard, strike, both.`;
    }

    function describe(): void {
      const name = weapons[weapon]?.name ?? 'their weapon';
      sentence.textContent = `${characterName} will use the ${name} by…`;
    }

    function updateCount(): void {
      const words = wordCount(prompt.value);
      counter.textContent = `${words} / ${MAX_PROMPT_WORDS}`;
      // Over the limit is a warning, not a block: the server trims, and
      // stopping mid-word as someone types is worse than letting them finish.
      counter.classList.toggle('is-over', words > MAX_PROMPT_WORDS);
    }

    function pick(index: number): void {
      weapon = index;
      for (const [i, node] of weaponButtons.entries()) {
        node.setAttribute('aria-pressed', String(i === index));
      }
      describe();
      // Switching to a shield hands them a second guard; switching away takes
      // it back, and leaving a stale one on screen would promise a block the
      // server is not going to honour.
      refreshGuards();
    }

    function submit(): void {
      if (submitted) return;
      submitted = true;
      connection.send({ type: 'submitMove', weapon, prompt: prompt.value, defend, attack });
      status.textContent = 'Sent — watch the big screen.';
      send.disabled = true;
      prompt.disabled = true;
      for (const node of weaponButtons) node.disabled = true;
    }

    /**
     * Each weapon as its own drawing, not just its name.
     *
     * A player has three weapons and fifty words to describe using one of
     * them; picking from a row of names means remembering which was which,
     * when they drew all three ten minutes ago.
     */
    const previews: HTMLImageElement[] = [];
    weapons.forEach((w, index) => {
      const preview = el('img', { class: 'weapon-preview', alt: '' });
      preview.hidden = true;
      previews.push(preview);

      const node = el('button', { class: 'weapon-pick', type: 'button' },
        preview,
        el('span', { class: 'weapon-name' }, w.name),
      );
      node.setAttribute('aria-pressed', String(index === 0));
      node.addEventListener('click', () => pick(index));
      weaponButtons.push(node);
      weaponRow.appendChild(node);
    });

    // The artwork is on the server; a phone asks for its own and nobody
    // else's. Names are already on screen, so the pictures fill in when they
    // arrive rather than holding the screen up.
    connection.on({
      onArt: (art) => {
        const mine = art.find((entry) => entry.playerId === connection.playerId);
        if (!mine) return;
        for (const [index, preview] of previews.entries()) {
          const png = mine.weapons[index]?.png;
          if (!png) continue;
          preview.src = png;
          preview.hidden = false;
        }
      },
    });
    connection.send({ type: 'requestArt' });

    prompt.addEventListener('input', updateCount);
    describe();
    refreshGuards();
    updateCount();

    /*
     * A few moves somebody else already wrote.
     *
     * A blank box and a clock is the hardest part of this game for anybody not
     * already in the mood, and what people fall back on is "swing it at them"
     * — the dullest move available and the lowest-scoring one. These are here
     * to show how far the writing is allowed to go; picking one is fine, and
     * reading one and then writing something worse is the actual point.
     *
     * Filled into the box rather than sent, so it can still be edited — and
     * the same few for everybody on a given turn, so a room can talk about
     * them.
     */
    const ideas = el('div', { class: 'move-ideas' });
    for (const idea of suggestionsFor(turnSeed)) {
      const node = button(idea.label, () => {
        prompt.value = idea.text;
        updateCount();
        prompt.focus();
        play('click');
      }, 'ghost idea');
      node.title = idea.text;
      ideas.appendChild(node);
    }

    root.append(
      el('main', { class: 'screen screen-move' },
        heading, stakes, clock.root, weaponRow, sentence,
        /*
         * The two guesses come before the writing.
         *
         * In that order because that is the order they are decided in: a
         * guard is a reaction to what you think is coming, an aim is a bet on
         * where they are not looking, and the fifty words are a description
         * of a blow whose direction is already settled. Putting the writing
         * first would have people describe an overhead slam and then pick
         * "left" underneath it.
         */
        el('section', { class: 'strategy-box' },
          el('h2', { class: 'strategy-title' }, 'Guard and strike'),
          el('p', { class: 'strategy-what' },
            'Both of you choose blind. Guard the side they strike and their hit is halved.'),
          ring.root,
          el('div', { class: 'side-legend' },
            el('span', {}, el('i', { class: 'k-guard' }), 'Guard'),
            el('span', {}, el('i', { class: 'k-strike' }), 'Strike'),
            el('span', {}, el('i', { class: 'k-both' }), 'Both')),
          ringNote),
        el('h2', { class: 'strategy-title' }, 'How you fight'),
        prompt,
        el('div', { class: 'tool-row' }, counter),
        send, status,
        el('p', { class: 'ideas-hint' }, 'Stuck? Try one of these, or something worse:'),
        ideas,
      ),
    );

    /**
     * Hands the phone back to the battle screen once the move is out of the
     * player's hands.
     *
     * All the phase routing — the next turn, an Ultimate, the results — lives
     * there, so leaving a phone parked on this screen would strand it for the
     * rest of the game.
     */
    function leave(): void {
      if (left) return;
      left = true;
      clock.stop();
      void import('./battle').then(({ battleScreen }) => {
        go(battleScreen(connection, false));
      });
    }

    /** Whether this is the round that counts double. */
    function showStakes(state: RoomState): void {
      const final = isFinalRound(state);
      stakes.textContent = final ? 'Final round — this one counts double' : '';
      stakes.hidden = !final;
    }

    connection.on({
      onClosed: () => goHome(go),
      onState: (state: RoomState) => {
        showStakes(state);
        if (left) return;
        const turn = state.turn;
        if (!turn || state.phase !== 'battle') { leave(); return; }

        if (turn.phase === 'picking') {
          clock.setDeadline(state.stepEndsAt, MOVE_SECONDS);
          return;
        }

        clock.setDeadline(0, 1);
        /*
         * Time ran out or the other player finished; either way the turn is
         * gone. What somebody wrote is not.
         *
         * Writing an attack and not pressing the button is not the same as
         * writing nothing, and it used to be treated as if it were: the turn
         * ended, the sentence was thrown away and the AI invented something
         * else. A weapon is always chosen — the first is selected from the
         * start — so a non-empty prompt is a complete move and gets sent.
         */
        if (!submitted) {
          const written = prompt.value.trim();
          submitted = true;
          send.disabled = true;
          prompt.disabled = true;
          if (written) {
            connection.send({ type: 'submitMove', weapon, prompt: prompt.value, defend, attack });
            status.textContent = 'Time — sent what you wrote.';
          } else {
            status.textContent = 'Time — the AI will improvise.';
          }
        }
        leave();
      },
    });

    if (connection.state) {
      clock.setDeadline(connection.state.stepEndsAt, MOVE_SECONDS);
      showStakes(connection.state);
    }

    return () => clock.stop();
  };
}
