# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A group of two to six people, together in a room or spread across a call, with
one laptop between them and a phone each.

- **The host screen** is a laptop in the middle of the room, running a browser
  everybody can see. It is not a player. It animates the fight, narrates it and
  plays the music; it is the only device that does any of those things.
- **Players** are on their own phones, two to six of them. Each draws a
  character and two weapons, names them, and on their turn writes how they
  attack. Nobody is assumed to be able to draw.
- **Judges** are whoever is not fighting: in a three- or five-player game the
  other players score the exchange and the scores are averaged; in a
  two-player game an AI judges instead.
- **Eventually, strangers.** The intention is public release, so the game has
  to be hostable cold by someone who has never seen it and has nobody to ask.
  Nothing may depend on the author being in the room.

## Product Purpose

A party game in which the players make all of the content.

Each person draws a character and two weapons on their phone and names them.
Each turn they pick a weapon, choose where to guard and where to strike, and
finish the sentence *"<character> will use the <weapon> by…"* in up to fifty
words. That sentence goes to Claude, which returns a choreography built from a
fixed vocabulary of moves, and the host screen performs it using that player's
own drawings. A judge scores the attack out of 33, and that score is the damage
it does.

Everyone starts on 100 health. Each character fights three rounds, the last
counting double, and **the side that takes the least damage wins** — so hitting
hard is only half of it. A tie sends both sides back to draw one more weapon as
an Ultimate and fight again.

**Success, as of now:** one complete game played start to finish by people who
did not build it — no freeze, no stranded screen, nothing on screen that needs
explaining. That is the single gate between the current release candidate and a
beta, and it outranks new features until it is cleared.

## Positioning

The fight is made of the players' own drawings and their own sentences, and
neither is chosen from a list.

A neighbouring party game offers a menu of attacks. Here the attack is free
text, and the animation is generated per move: "trip them with the handle" and
"slam it down like a thunderbolt" produce different choreographies, performed
by a character the player drew ten minutes earlier on their phone. The drawings
are the sprites. The sentence is the script. Everything on screen came out of
the room it is being shown in.

## Operating Context

- **One screen performs, the phones control.** The laptop runs WebGL, speaks,
  and plays music. The phones are controllers and drawing boards, held in one
  hand and drawn on with a finger.
- **A loud room.** People talk over it, lean in to see the screen, and pass
  comment on each other's drawings. Anything important has to survive being
  half-watched.
- **Also across the internet.** Players have joined from other countries;
  artwork has to arrive over a slow connection without stranding anyone with a
  stand-in.
- **Everything is on a clock.** 105s to draw a character, 20s to name it, 60s
  per weapon and 20s to name each, 20s to vote on a battleground, 50s to write
  a move, 30s to judge it. The clock is a prompt, not a punishment: running out
  of time never stops the game, it just decides for you.
- **Devices come and go.** A phone that locks, reloads or loses signal has 25
  seconds of grace and gets its seat back. Rooms outlive the devices in them.

## Capabilities and Constraints

- Two to six players, four-letter room codes. Two is 1v1 with an AI judge;
  three or five has the non-fighters judge; four or six is tag team, each side
  sending one character out at a time.
- One PartyKit worker serves the page, the `/api` endpoints and the multiplayer
  rooms from a single origin — no second host, no CORS, and the client finds
  the rooms without being told where they are.
- Rendering is Pixi.js v7 on WebGL and all animation is GSAP. A device that
  cannot run WebGL cannot be the host screen.
- Websocket messages are capped at 1 MiB and **exceeding it closes the socket
  rather than failing the message**, so artwork is sent one picture at a time
  and reassembled on arrival.
- **Every AI call is server-side.** The Anthropic key lives only in
  `.env.local` — never in `.env`, because PartyKit reads `.env` when it
  deploys; never in the repository; never in a git remote URL. Both files are
  gitignored and every commit is checked before it is made. This is a hard
  constraint, not a preference.
- `partykit.json` sets `serve.browserTTL` to 0. The two-day default cached
  `index.html`, which names the hashed bundles, so for forty-eight hours after
  a deploy the fix was live and no phone was asking for it.
- **The original brief is a starting point, not a specification.** The scoring
  out of 33, least-damage-taken, three rounds each, the tie-into-Ultimate rule
  and the Mario Kart vote draw all came from it, and code comments citing "the
  brief" record where a rule came from rather than a commitment to keep it.
  Core rules are the author's to change.
- Branching is `main` plus `dev`; completed work is pushed to `dev`.
- The code is kept optimisable: low coupling, high cohesion.

## Brand Commitments

- The name is **Jabbloo**. It plays at `jabbloo.teajammin.partykit.dev`.
- The game is absurd and deadpan, and never apologises for itself. A character
  nobody named gets a joke rather than a label — "Sir Bonkloid", not
  "Nameless" — because telling someone their fighter is the one nobody
  bothered with reads badly on a big screen in front of a room.
- **Players' artwork is never corrected or prettified.** Whatever they drew is
  what fights.
- Control and icon choices the author has settled stay settled. Swapping them
  unasked has been reverted once already.

## Evidence on Hand

- **Artwork, with provenance.** 18 effect sprites are public-domain or CC0
  photographs whose licence, author and source are recorded per sprite in
  `public/photo-credits.json`; 18 more were drawn by hand for the game; the
  remainder are generated by `scripts/generate-effects.mjs`. A sprite
  inventory page lists all of them with their origin.
- **Music, with provenance.** Two tracks in `public/music`, credited in
  `public/music/credits.json` as Pixabay Content License — and flagged there as
  *inferred from the filenames rather than verified*, which is worth settling
  before public release.
- **Automated checks.** `npm test` runs the unit and screen suites with nothing
  else running; eleven integration suites drive a real PartyKit room over a
  websocket; `scripts/e2e-host.mjs` drives the host's arena through a whole
  fight in headless Chrome, which is the only thing that can see the WebGL
  stage.
- **No testimonials, no user numbers, no press, no pricing, no case studies.**
  None exist. Future work must not invent any.
- The README is the fullest written account of the game and has drifted from
  the code in places (weapon count and some step timings). The code is
  authority where they disagree.

## Product Principles

1. **The players' content is the product.** Their drawing, their sentence,
   their name. Anything the game adds sits behind what they made.
2. **The screen performs; the phones control.** One device is the show. Six
   phones all narrating the same fight is not a show.
3. **Nothing strands a device.** A locked phone, a reload, a dropped
   connection, a player who wrote nothing — each has a defined outcome that
   keeps the game moving.
4. **A rule the room cannot see is not a rule.** If a choice changes the
   damage, the room has to be able to watch it happen.
5. **The clock decides for you; it never stops you.** Running out of time
   produces a move, a name, a vote — never a dead end.

## Accessibility & Inclusion

Implemented, and to be preserved:

- Reduced motion, seeded from the operating system's own preference so someone
  who has already asked their phone does not have to ask again. It shortens
  the fight rather than removing it.
- Larger text and a high-contrast mode.
- Separate volumes for music and effects, and a switch for whether the host
  screen narrates aloud at all.
- **Whatever is spoken is also on screen.** Narration is never the only
  carrier of information.
- Nobody is assumed to be able to draw, or to finish. A player who draws
  nothing still gets a named character and fights.

No external standard has been adopted as a requirement.
