/**
 * Drives a room through creation, for suites that only want a battle.
 *
 * Each player now walks their own path at their own pace, so a script of steps
 * and sleeps no longer describes what is happening: one player can be naming
 * their second weapon while another is still drawing their character. This
 * answers whatever step each player is actually on, until the room moves on.
 */
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SLOTS = ['character', 'weapon0', 'weapon1', 'weapon2'];

/** The step list the room is working through, mirroring the protocol's own. */
function stepAt(index, ultRound) {
  if (ultRound > 0) {
    const slot = `weapon${3 + ultRound - 1}`;
    return [{ slot, kind: 'draw' }, { slot, kind: 'name' }][index] ?? null;
  }
  const slot = SLOTS[Math.floor(index / 2)];
  if (!slot) return null;
  return { slot, kind: index % 2 === 0 ? 'draw' : 'name' };
}

/**
 * Answers every step for every player until creation is over.
 *
 * `sockets` is keyed by player id, so each answer goes to the right seat.
 */
export async function makeEverything(host, sockets, state, wait, options = {}) {
  const { names = (slot) => `${slot} name` } = options;

  for (let guard = 0; guard < 200; guard++) {
    const now = state(host);
    if (!now || (now.phase !== 'creating' && now.phase !== 'ult')) return now;

    let answered = false;
    for (const player of now.players.filter((p) => !p.isHost)) {
      const ws = sockets[player.id];
      if (!ws || player.progress.done) continue;

      const step = stepAt(player.progress.step, now.ultRound);
      if (!step) continue;

      ws.send(JSON.stringify(step.kind === 'draw'
        ? { type: 'submitDrawing', slot: step.slot, png: PNG, done: true }
        : { type: 'submitName', slot: step.slot, name: names(step.slot) }));
      answered = true;
    }

    await wait(answered ? 140 : 90);
  }

  return state(host);
}
