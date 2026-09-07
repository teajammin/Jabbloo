# Jabbloo

A whimsical, Jackbox-style multiplayer party game for the browser. Players draw their own
characters and weapons on their phones, then describe — in their own words — how they want
to attack. An AI turns that description into a real animated move, and a judge scores it.

**Status:** playable end to end, and never yet run in a real browser — see
[What has not been tested](#what-has-not-been-tested). Version 0.1.0.

---

## The Game

Each player draws a character and three weapons. Characters then fight in turns. On their
turn, a player picks a weapon and writes up to 50 words describing how they'll use it. An AI
choreographs that description into a short animation (max 7 seconds). If the description
doesn't make sense, the weapon just bonks the opponent like a sword.

A judge — either an AI or the non-fighting players — rates each move out of 33. Every player
starts with 100 health. Games are best of 3 rounds; the team that takes the least damage wins.
A tie forces both sides to create one more weapon as an ULT and fight one more
round with it; after two ULTs a level game is declared a tie.

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

A ⚙ button sits on every screen: accessibility (reduced motion, larger text,
high contrast), volume, how to play, credits, and quit. Sound is synthesised
in `src/audio.ts` rather than sampled, so the game ships with no audio assets.

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

## Running It

```sh
npm install
cp .env.example .env.local      # then fill in ANTHROPIC_API_KEY
npm run dev                     # vite + express + partykit, all three
```

Open the host screen on a laptop at the address Vite prints, create a room, and
join from phones on the same network at `<laptop-ip>:5173`. The room code is the
join code.

Keys live in `.env.local`, never in `.env`: PartyKit reads `.env` when it deploys
the multiplayer room, and that room needs no keys at all, so keeping them
elsewhere means a deploy cannot carry them off the machine. Both files are
gitignored. Every AI call is made by the Express backend — no key ever reaches a
browser.

### Tests

```sh
npm test              # pure logic: protocol, parsing, settings, limb detection
npm run dev:party     # in one terminal, then in another:
npm run test:room     # and :creation :battleground :battle :turns :judging :ult :bots
```

The integration suites drive a real PartyKit room over a websocket, because the
rules being checked — who may score, what happens when someone drops, when a tie
becomes an ULT — only exist as behaviour of the running server.

---

## What Has Not Been Tested

Every line here was written without a browser to run it in. The logic is covered
by tests; the pixels are not. Specifically unverified:

- Anything visual: layout, the drawing tool's feel, the battle canvas
- Phone browsers entirely — iOS Safari's file picker and `<input type="color">`
  in particular
- Multi-device play: a real host laptop with real phones on the same network
- The AI round trip end to end with a live key

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

Thirty of them, grouped in `src/engine/primitives/`: locomotion, weapon work,
melee, acrobatics, ranged, specials and effects. `PRIMITIVE_NAMES` is the list
the choreographer is given and the list the parser accepts — one definition, so
the prompt and the engine cannot drift apart.

The set is deliberately broad enough for what players actually write: uppercuts,
leg sweeps, roundhouses, handsprings, teleports, breathing fire, throwing the
sun. A move marked `on: "enemy"` is applied to the other fighter, which is how
one player's sentence can knock the other one down.

All durations are in seconds and a whole choreography is capped at seven, with
overruns time-scaled to fit rather than truncated. If the AI returns something
unusable, the engine falls back to a default swing — the weapon hits the
opponent like an axe.

### Limbs

Characters are flat PNGs with no skeleton, so kicks and punches have nothing to
articulate. The engine draws procedural bubble limbs, colour-sampled from the
character's own artwork, which appear only for the duration of a melee move.

Player art is scanned first (`src/engine/limbs.ts`): legs read as two separated
runs near the bottom of the silhouette, arms as rows markedly wider than the
body. Where the drawing has its own, the procedural limb is suppressed and the
weapon anchor moves onto the hand the player drew.

---

## Assets

`public/letters/` and `public/effects/` are generated — `npm run gen:letters`,
`npm run gen:effects`. Both are original artwork drawn procedurally, so they can
be re-rendered at any resolution.

`public/placeholder-*.png` are generated too (`npm run gen:placeholders`) and
stand in for anything a player never drew — the Sword, Axe and Hammer the brief
names as fallbacks.

Sound has no assets at all: every cue in `src/audio.ts` is synthesised from
oscillators and an envelope.

## Repository

Branching follows a **main + dev** strategy.

- `main` — stable
- `dev` — active development; each completed task is pushed here

## Contributing

Code should stay optimisable, low-coupling, high-cohesion, and easy to build on.
