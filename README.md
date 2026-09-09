# Jabbloo

A party game where the players draw everything. You sketch a character and
three weapons on your phone, then describe in fifty words how you attack. An AI
turns the sentence into a real animation, and a judge scores it out of 33.

**Play: https://jabbloo.teajammin.partykit.dev** — one host screen, everyone
else on their own device, anywhere in the world.

---

## The game

Everyone draws a character and three weapons, names them, and votes on a
battleground. Then the characters fight.

On your turn you pick one of your weapons and finish the sentence
*"<your character> will use the <weapon> by…"* in up to fifty words. The
description goes to Claude, which returns a choreography — a list of moves from
a fixed vocabulary — and the host screen plays it out with your drawings.

A judge scores each attack out of 33: either the players who are not fighting,
or an AI when there are only two of you. Everyone starts on 100 health, each
character fights three rounds, and **the side that takes the least damage
wins** — so hitting hard is only half of it. A tie sends both sides back to
draw one more weapon as an ULT and fight again; after two of those, a tie
stands.

| Players | Format |
|---|---|
| 2 | 1v1, an AI judges |
| 3 or 5 | The players not fighting judge, scores averaged |
| 4 or 6 | Tag team — each side sends one character out at a time |

Six players maximum, four-letter room codes.

### The flow

1. **Launch** — create a room, or join one
2. **Lobby** — the host sees a join address, a QR code and the room code; players are dragged into teams and the judges' bench
3. **Creation** — draw a character (90s), name it (20s), then three weapons (45s and 20s each)
4. **Battleground** — everyone votes; one vote is drawn at random, Mario Kart style
5. **Battle** — fighters are announced by name and walk on, then each player writes their move and watches it play
6. **Judging** — a slider per fighter, or the AI
7. **Results** — damage given and taken per player, and the hardest hit quoted
8. **Rematch, new game, or back to the menu**

A ⚙ on every screen holds accessibility settings (reduced motion, larger text,
high contrast), volume, how to play, credits and quit.

---

## Running it

```sh
npm install
cp .env.example .env.local        # then fill in ANTHROPIC_API_KEY
npm run dev                       # vite + express + partykit together
npm run stop                      # stops all three
```

Open the host screen on a laptop, then join from phones on the same wifi. The
lobby shows the address and a QR code for it — don't use `localhost` on the
host, because that address means something different on every device that
reads it. The dev server asks the backend for the machine's real LAN address
and shows that instead.

Keys live in `.env.local`, never in `.env`. PartyKit reads `.env` when it
deploys, and the multiplayer server needs no keys at all, so keeping them
elsewhere means a deploy cannot carry them off the machine. Both files are
gitignored, and every AI call is made server-side — no key ever reaches a
browser.

### Tests

```sh
npm test                  # 219 checks: protocol, settings, limb detection, API, every screen
npm run dev:party         # then, in another terminal:
npm run test:room         # and :creation :battleground :battle :turns
npm run test:judging      # and :ult :bots :limits :endgame
```

`npm test` needs nothing running. The ten integration suites drive a real
PartyKit room over a websocket, because the rules they check — who may score,
what happens when someone drops, when a tie becomes an ULT — exist only as
behaviour of the running server. 154 checks across those.

The screen tests deserve a mention: every screen is plain DOM, so they mount
and drive it in Node against a stubbed browser — a stroke through the drawing
tool with real pointer events, ⌘Z, an export, a move written and sent, a judge
scoring. That harness is the only thing standing between a broken screen and a
phone in someone's living room.

---

## Deploying

```sh
npx partykit login        # once
npm run deploy:env        # once — paste the Anthropic key
npm run deploy
```

One worker serves three things from one origin: the static page, the `/api`
endpoints and the multiplayer rooms. No second host, no CORS, and because the
page and the party server share an origin the client finds the rooms without
being told where they are.

`npm run logs` tails the deployed server. `npm run deploy:preview` puts a build
on a separate URL, for trying something without disturbing a live game.

| | Development | Deployed |
|---|---|---|
| Page | Vite on :5173 | PartyKit static assets |
| `/api` | Express on :8787, via Vite's proxy | `Room.onFetch` in the worker |
| Rooms | `partykit dev` on :1999 | The same worker |
| Key | `.env.local` | PartyKit environment |

Both columns run the *same* API: `server/api.ts` is a function from a path and
a body to a status and some JSON, with no reference to Express, Request or
Response. The dev server and the worker are two thin shells around it, so
development exercises the code production runs rather than its twin.

---

## How it works

**The host screen draws; phones are controllers.** The brief's Jackbox shape,
and it decides the architecture: the Pixi canvas, the choreography requests and
the artwork all live on the host, and a phone only ever sends intents.

**The server owns the state.** Clients send messages and render whatever comes
back — never their own optimistic copy — so the host screen and every phone
always agree. Deadlines are absolute timestamps rather than durations, so a
phone that slept or joined late lands on the same instant as everyone else.

**One protocol module, imported by both sides.** `src/shared/protocol.ts` holds
every message shape and every rule that both ends need — the creation steps,
the win condition, the word limit. A change to it breaks the compile rather
than surfacing as a silent mismatch between host and phone.

**Artwork is kept out of the broadcast state.** A character PNG runs to
hundreds of kilobytes; sending everyone's to everyone on every state change
would swamp a phone. The server holds it aside and hands it over when the
battle needs it — one message per player, because the platform closes a
socket that carries more than a megabyte.

### Layout

```
src/
  engine/        the battle canvas: stage, fighter rig, primitives, playback
  draw/          the drawing surface: strokes, images, masks
  ui/            every screen, as plain DOM
  net/           the client's room connection
  shared/        the wire protocol, imported by client and server
  settings.ts    accessibility and volume, persisted per device
  audio.ts       every sound, synthesised — the game ships no audio files
party/room.ts    the multiplayer server: one instance per room code
server/          the AI backend, shared by the dev server and the worker
scripts/         asset generators: letters, effects, placeholders
test/            unit, screen and integration suites
```

### The animation engine

`src/engine/` is standalone — it knows about sprites, anchors and a canvas, and
nothing about rooms, players or scoring. That is what lets it be driven from a
test, a replay or a multiplayer message just as easily as from a fetch.

Thirty primitives make up the vocabulary the choreographer may call:

```
move_to charge recoil jump          locomotion
spin_weapon swing slam throw        weapon
kick punch headbutt bite lick grab stomp   melee
flip handspring teleport taunt      acrobatics
projectile beam shockwave summon    ranged
inhale grow shrink knockdown dizzy  special
shake_screen idle                   effects
```

A move marked `on: "enemy"` is applied to the other fighter, which is how one
player's sentence can knock the other one down. Durations are in seconds and a
whole choreography is capped at seven, with overruns time-scaled to fit rather
than truncated. Anything unusable — a refused request, malformed JSON, an
invented move name — becomes a default swing, so a fight never stalls on a
model's bad day.

**Limbs.** Characters are flat PNGs with no skeleton, so kicks have nothing to
articulate. The engine draws procedural bubble limbs, colour-sampled from the
character's own artwork, that appear only for the duration of a melee move.
Player art is scanned first (`src/engine/limbs.ts`): legs read as two separated
runs near the bottom of the silhouette, arms as rows markedly wider than the
body. Where the drawing has its own, the procedural limb is suppressed and the
weapon anchor moves onto the hand the player drew.

### The AI

Two models, per the brief. **Haiku** choreographs, because turning a sentence
into a list of moves is structure and it is fast and cheap. **Sonnet** judges,
because deciding whether a move is inventive and whether it would plausibly
hurt is taste. Sonnet is also the choreographer's fallback.

The system prompt is byte-stable so it can be cached, and documents every
primitive with worked examples mapping the phrasings players actually use.

---

## Look and feel

The interface is dark: an ink-plum page with a few saturated accents and cream
type. That is not a style preference — it is what Jackbox, Kahoot, Fall Guys,
skribbl and Gartic Phone all do, measured from their own stylesheets. Pastels
on a pale page is the one combination none of them use, and it is what made
this read as a children's app rather than a fighting game. The bubble lettering
did not change: pastel on dark reads as neon sweets.

Colour tokens are named for what a colour is *for* — `--paper`, `--panel`,
`--text`, `--accent`, `--team-a` — so a change of mind is one block rather than
a hundred edits. Every foreground/background pair in the scheme is measured
against WCAG in `test/` terms: fifteen of fifteen pass, body text at 14.5:1.

Behind the menus, four deep glows shift a little and come back, over fixed film
grain. Not a pan: a sliding gradient has to tile, and a tile boundary at an
angle crosses the screen as a visible line. The battle stage and the drawing
screen opt out — both fill the window with their own thing, and a background
nobody can see still costs every frame.

---

## Assets

Everything in `public/` is generated by this repo except the battlegrounds:

- `public/letters/` — the bubble alphabet, drawn as boolean geometry in
  `scripts/generate-letters.mjs` and rasterised by a home-made PNG encoder.
  `npm run gen:letters`.
- `public/effects/` — fire, beams, shockwaves, anvils, pianos.
  `npm run gen:effects`.
- `public/placeholder-*.png` — the stand-in character and the Sword, Axe and
  Hammer a player gets if they never drew their own. `npm run gen:placeholders`.
- `public/battlegrounds/` — photographs from [Pexels](https://www.pexels.com),
  used under their licence (commercial use, no attribution required) and
  credited in the options menu regardless.

Sound has no assets at all: every cue in `src/audio.ts` is synthesised from
oscillators and an envelope.

---

## Decisions worth knowing

Things that look odd until you know why.

**Saving is not finishing.** The drawing tool autosaves every ten seconds, when
a step ends and when the screen sleeps, so work survives a dead phone or an
expired timer. Those saves must not mark the player ready, or the first stroke
everyone makes would end a ninety-second step in seconds.

**Identity is per tab, not per browser.** The server keys a player's seat on
their connection id, which is kept in session storage. Local storage is shared
across tabs, so a host screen and a player in another tab of the same browser
handed the server the same identity and the second silently displaced the
first.

**Nothing may exceed a megabyte in one message.** The platform does not reject
an oversized message, it closes the socket carrying it. Photos are shrunk to
avatar size before sending, drawings are exported at the largest size that
fits, and artwork is delivered one player per message.

**Every turn carries an index.** Screens key their state on it. Without one, a
second round between the same two fighters is indistinguishable from the
first — which is how the judges' sliders stopped rebuilding after round one.

**Bots write immediately.** A player whose phone dies keeps their seat and
their drawings, and a bot takes their turns — the moment the turn opens, not
after the move clock expires, because a bot that waits out the full minute
leaves the player opposite staring at an empty stage.

---

## What has not been tested

The logic is covered by tests, including a jsdom pass that mounts and drives
every screen. What that cannot cover is how any of it looks or feels:

- Phone browsers — iOS Safari's file picker and pinch handling in particular
- The dark scheme in daylight, and whether the film grain is visible at all
- Whether hand-erasing a photo is workable with a finger

---

## Repository

`main` is stable; `dev` is where work lands. Every completed task is a commit
on `dev` with an explanation of *why* rather than what.

Code should stay optimisable, low-coupling and high-cohesion — the engine
knowing nothing about the network, the protocol knowing nothing about screens,
and the API knowing nothing about which server is calling it.
