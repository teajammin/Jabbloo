import { el } from './screens';
import type { RoomConnection } from '../net/room';
import { displayName, type Player, type Role, type RoomState } from '../shared/protocol';

/**
 * The host's team arrangement board.
 *
 * Per the brief this exists only on the host laptop — phones never arrange
 * teams. Players are moved between four zones: two teams, a judges bench, and
 * an unassigned pool everyone starts in.
 *
 * Three ways to move someone, because drag alone excludes too many people:
 *   - drag a card onto a zone (mouse)
 *   - click a card to pick it up, click a zone to drop it (touch, and steadier
 *     than dragging on a trackpad)
 *   - focus a card and press A, B, J or U (keyboard)
 *
 * The board renders from server state on every update rather than tracking its
 * own, so a player joining or leaving mid-arrangement can't desync it.
 */

interface Zone {
  role: Role;
  label: string;
  list: HTMLUListElement;
  root: HTMLElement;
  /** Team names are editable; "Judges" and "Waiting" are fixed. */
  nameInput?: HTMLInputElement;
}

export interface TeamBoard {
  root: HTMLElement;
  update: (state: RoomState) => void;
}

export function teamBoard(connection: RoomConnection, seats = 0): TeamBoard {
  /** The card currently picked up by click, if any. */
  let selected: string | null = null;

  const zones: Zone[] = [
    makeZone('teamA', 'Team One', true),
    makeZone('unassigned', 'Waiting', false),
    makeZone('teamB', 'Team Two', true),
    makeZone('judge', 'Judges', false),
  ];

  /*
   * Laid out correctly before anything arrives from the server.
   *
   * The host has already said how many are playing, so whether there is a
   * judges' bench is known here and now. Waiting for the first state to decide
   * meant the bench appeared and then vanished, and the board jumped as the
   * row collapsed under it.
   */
  zones.find((z) => z.role === 'judge')!.root.hidden = seats > 0 && !needsJudges(seats);

  /**
   * Judges only exist at odd player counts.
   *
   * Two is a duel with an AI judge; four and six are tag team, where everyone
   * fights. An empty bench in those games only invites the host to strand
   * somebody on it.
   */
  function needsJudges(count: number): boolean {
    return count % 2 === 1;
  }

  function assign(playerId: string, role: Role): void {
    connection.send({ type: 'setRole', playerId, role });
    setSelected(null);
  }

  function setSelected(id: string | null): void {
    selected = id;
    for (const card of board.querySelectorAll<HTMLElement>('.card')) {
      const isSelected = card.dataset['id'] === id;
      card.classList.toggle('picked', isSelected);
      card.setAttribute('aria-pressed', String(isSelected));
    }
    board.classList.toggle('placing', id !== null);
  }

  function makeZone(role: Role, label: string, editable: boolean): Zone {
    const list = el('ul', { class: 'zone-list' });
    list.setAttribute('role', 'list');

    let nameInput: HTMLInputElement | undefined;
    let heading: HTMLElement;

    if (editable) {
      nameInput = el('input', {
        type: 'text',
        class: 'zone-name',
        value: label,
        maxLength: 18,
      });
      nameInput.setAttribute('aria-label', `${label} name`);
      nameInput.addEventListener('change', () => {
        connection.send({
          type: 'setTeamName',
          team: role === 'teamA' ? 'teamA' : 'teamB',
          name: nameInput!.value,
        });
      });
      heading = nameInput;
    } else {
      heading = el('h2', { class: 'zone-name static' }, label);
    }

    const root = el('section', { class: `zone zone-${role}` }, heading, list);
    root.setAttribute('aria-label', label);

    // Mouse drag.
    root.addEventListener('dragover', (event) => {
      event.preventDefault();
      root.classList.add('over');
    });
    root.addEventListener('dragleave', () => root.classList.remove('over'));
    root.addEventListener('drop', (event) => {
      event.preventDefault();
      root.classList.remove('over');
      const id = event.dataTransfer?.getData('text/plain');
      if (id) assign(id, role);
    });

    // Click-to-place: a card is picked up first, then a zone is clicked.
    root.addEventListener('click', () => {
      if (selected) assign(selected, role);
    });

    return { role, label, list, root, ...(nameInput ? { nameInput } : {}) };
  }

  function card(player: Player): HTMLLIElement {
    const avatar = player.photo
      ? el('img', { class: 'avatar', src: player.photo, alt: '' })
      : el('span', { class: 'avatar placeholder' }, player.name.slice(0, 1).toUpperCase());

    const node = el('li', { class: `card${player.connected ? '' : ' offline'}` },
      avatar,
      el('span', { class: 'card-name' }, displayName(player)),
    );

    node.dataset['id'] = player.id;
    node.draggable = true;
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-pressed', 'false');
    node.setAttribute(
      'aria-label',
      `${player.name}. Press A for team one, B for team two, J for judge, U to unassign.`,
    );

    node.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', player.id);
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('dragging'));

    node.addEventListener('click', (event) => {
      // Without this the click bubbles to the zone and instantly re-drops.
      event.stopPropagation();
      setSelected(selected === player.id ? null : player.id);
    });

    node.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      const role: Role | null =
        key === 'a' ? 'teamA'
        : key === 'b' ? 'teamB'
        : key === 'j' ? 'judge'
        : key === 'u' ? 'unassigned'
        : null;

      if (role) {
        event.preventDefault();
        assign(player.id, role);
        return;
      }
      if (key === 'enter' || key === ' ') {
        event.preventDefault();
        setSelected(selected === player.id ? null : player.id);
      }
    });

    return node;
  }

  const hint = el('p', { class: 'help-note board-hint' },
    'Drag players into place, or click one and click where it goes. Keyboard: focus a player, then press A, B, J or U.');

  const board = el('div', { class: 'board' }, ...zones.map((z) => z.root));

  // Clicking empty space cancels a pick-up.
  board.addEventListener('click', () => setSelected(null));

  const root = el('div', { class: 'board-wrap' }, board, hint);

  // Nothing is shown until the board knows what it holds.
  root.hidden = true;

  function update(state: RoomState): void {
    const players = state.players.filter((p) => !p.isHost);
    // Shown once it knows what it is: building it visible and correcting it a
    // moment later is what made the judges' bench flash up and vanish.
    root.hidden = false;

    for (const zone of zones) {
      zone.list.replaceChildren();
      const members = players.filter((p) => p.role === zone.role);
      for (const player of members) zone.list.appendChild(card(player));

      zone.root.classList.toggle('empty', members.length === 0);

      if (zone.nameInput && document.activeElement !== zone.nameInput) {
        // Don't clobber what the host is mid-way through typing.
        zone.nameInput.value =
          zone.role === 'teamA' ? state.teamNames.teamA : state.teamNames.teamB;
      }
    }

    // Kept visible if someone is already on the bench, so nobody can vanish.
    const judgeZone = zones.find((z) => z.role === 'judge')!;
    const count = state.capacity || players.length;
    const hasJudges = players.some((p) => p.role === 'judge');
    judgeZone.root.hidden = !needsJudges(count) && !hasJudges;

    setSelected(selected && players.some((p) => p.id === selected) ? selected : null);
  }

  return { root, update };
}

/**
 * The same room, when there are only two people in it.
 *
 * A duel has nothing to arrange: one arrangement exists and the room makes it
 * at kick-off. Offering team names and four zones for it was a puzzle with a
 * single solution standing between two people and their game — so this shows
 * who is here instead of asking about it.
 *
 * Nothing is drawn for a seat nobody is in. Two waiting outlines are a promise
 * the room has not been given yet, and the first person to join should see
 * themselves arrive in an empty space rather than fill in a slot.
 */
export interface DuelBoard {
  root: HTMLElement;
  update: (state: RoomState) => void;
}

export function duelBoard(): DuelBoard {
  const sides = [side(), side()];
  const root = el('div', { class: 'duel-board' }, sides[0]!.root, sides[1]!.root);

  function update(state: RoomState): void {
    const players = state.players.filter((p) => !p.isHost);
    sides.forEach((seat, i) => seat.show(players[i]));
  }

  return { root, update };
}

/** One half of the screen: whoever is standing in it, or nothing at all. */
function side(): { root: HTMLElement; show: (player?: Player) => void } {
  const icon = el('div', { class: 'duel-icon' });
  const name = el('span', { class: 'duel-name' }, '');
  const root = el('div', { class: 'duel-side' }, icon, name);
  root.hidden = true;

  function show(player?: Player): void {
    root.hidden = !player;
    if (!player) return;

    name.textContent = displayName(player);

    // Their own photo if they brought one. Otherwise the plain figure, which
    // is a person rather than a placeholder — nobody is waiting on it.
    const hasPhoto = Boolean(player.photo);
    icon.classList.toggle('anon', !hasPhoto);
    icon.style.backgroundImage = hasPhoto ? `url(${JSON.stringify(player.photo)})` : '';
  }

  return { root, show };
}
