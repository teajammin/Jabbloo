# Jabbloo

A whimsical, Jackbox-style multiplayer party game for the browser. Players draw their own
characters and weapons on their phones, then describe — in their own words — how they want
to attack. An AI turns that description into a real animated move, and a judge scores it.

**Status:** early development. Version 0.1.0.

---

## The Game

Each player draws a character and three weapons. Characters then fight in turns. On their
turn, a player picks a weapon and writes up to 50 words describing how they'll use it. An AI
choreographs that description into a short animation (max 7 seconds). If the description
doesn't make sense, the weapon just bonks the opponent like a sword.

A judge — either an AI or the non-fighting players — rates each move out of 33. Every player
starts with 100 health. Games are best of 3 rounds; the team that takes the least damage wins.
A tie forces both sides to create one more weapon as an ULT.

### Player counts

| Players | Format |
|---|---|
| 2 | 1v1, AI acts as judge |
| 3 / 5 | 2 or 4 players fight, the rest judge (scores averaged) |
| 4 / 6 | Tag team — teams take turns sending characters out |

Maximum 6 players.

### Screens

The host laptop shows the shared screen; phones are the controllers, Jackbox-style.

1. **Launch** — title, version, create room / join room, help
2. **Create room** — pick player count, get a room code, assign teams and judges
3. **Join room** — username, optional photo, room code (phone or laptop)
4. **Character creation** — draw or upload (1.5 min), then name it (20 s)
5. **Weapon creation** — three weapons, 45 s each, all must be named
6. **Battleground selection** — every pick goes into a randomiser, Mario Kart style
7. **Battle stage** — choose weapon, describe the attack, watch it animate, get scored
8. **Results** — damage taken, damage given, best weapon + prompt. Rematch or menu.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Canvas rendering | Pixi.js v7 |
| Animation tweening | GSAP |
| Move choreographer | Claude Haiku (Sonnet fallback) |
| AI judge (2-player) | Claude Sonnet |
| Subject isolation (drawing "cast") | Remove.bg API |
| Multiplayer rooms | PartyKit |
| Backend | Node.js / Express — all AI calls server-side |

API keys live on the server. They are never shipped to the client.

---

## Build Order

The project is built one section at a time. Current scope:

**→ Battle Animation Engine** (in progress)

Nothing outside this scope is being built yet.

---

## Battle Animation Engine

Turns a player's text prompt into an animated fight sequence.

A player submits up to 50 words. The backend sends it to Claude, which returns a
**choreography JSON**. A Pixi.js engine plays that choreography back. The whole animation
must complete within 7 seconds.

### Sprites

Characters and weapons are separate transparent PNGs. A weapon attaches to its character at
a **hand anchor point** — a fixed offset from the character's centre — and can move
independently of the body during an animation.

### Animation primitives

These are the only moves the choreographer may call.

| Primitive | Params |
|---|---|
| `move_to` | `x` (0–1, % of canvas width), `duration` |
| `charge` | `target: "enemy"`, `duration` |
| `recoil` | `distance` (px), `duration` |
| `spin_weapon` | `rotations`, `duration` |
| `swing` | `direction: left\|right\|down\|up`, `arc` (degrees), `duration` |
| `slam` | `direction: down\|forward`, `duration` |
| `throw` | `target: "enemy"`, `returnAfter` (bool), `duration` |
| `jump` | `height` (px), `forward` (bool), `duration` |
| `shake_screen` | `intensity` (1–10), `duration` |
| `idle` | `duration` |

All durations are in seconds. If the AI returns something unusable, the engine falls back to
a default swing — the weapon hits the opponent like an axe.

### Limbs

Characters are flat PNGs with no skeleton, so kicks and punches have nothing to articulate.
The engine draws procedural bubble limbs, colour-sampled from the character's own artwork,
which appear only for the duration of a melee move.

**Planned:** when the drawing tool is built, player art must be scanned for limbs the player
actually drew, and those animated in preference. Procedural limbs are the fallback for
limbless characters only — drawing a capsule leg onto a character who already has two legs
reads as a bug.

---

## Repository

Branching follows a **main + dev** strategy.

- `main` — stable
- `dev` — active development; each completed task is pushed here

## Getting Started

Setup instructions will be added once the first buildable section lands.

## Contributing

Code should stay optimisable, low-coupling, high-cohesion, and easy to build on.
