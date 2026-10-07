---
version: 1
slug: "src-ui-creation-ts"
primary_target: "src/ui/creation.ts"
related_targets: ["src/ui/move.ts","src/styles.css"]
---

Scope: the creation flow and the attack screen on a player's phone — the two
surfaces a player spends almost all of their input time on. Visitor mode:
Operate. The host arena is out of scope except where it must read the same
colour vocabulary.

Audience: two to six people in a room with one laptop between them, phones in
hand, drawing with a finger against a clock. Nobody is assumed to be able to
draw, or to finish.

Task: make a character and one or two weapons inside a single pooled time
budget the player divides themselves; place a weapon on the character to decide
how it is held; then commit a guard side, one or two strike sides, and fifty
words, all before seeing what the opponent chose.

Constraints: the pooled budget is 285 seconds, the sum of the four steps it
replaces. Placement replaces grip.ts's measurement of how a weapon is held with
the player's own choice. A side may be both guarded and struck by the same
player, and that pad must show both at once.

## Direction contract

THESIS: Creation is a sticker library the player fills at their own pace, not a
queue of timed screens that march past them. It refuses the wizard — no step
counter, no forced order beyond the character coming first, no clock per task.
One budget, visible, spent however they like.

OWN-WORLD: Gumball Fields. A violet ground with saturated gumballs of yellow,
pink and teal pushing in from the corners, so colour owns regions rather than
sitting in accents. On top of it, every object is a die-cut sticker: cream
stock, a white kiss-cut margin, an ink die line in #2c1a5c, a seated drop, one
narrow off-axis gloss, each pressed on at its own slight angle. Baloo 2 bubble
letters. Guard is green, strike is red, and a side that is both shows one
sticker split corner to corner.

STORY: The player understands that the time is theirs to spend and the library
is theirs to fill. They believe a character they drew badly in ninety seconds
will still fight. They draw, name, fill a slot, watch it press onto the page,
and spend what is left where they want it.

FIRST VIEWPORT: The pooled clock across the top as a single draining bar with
the remaining time in bubble numerals and a Done sticker at its right. Beneath
it the library: three slots, the leftmost wider and reserved for the character,
two weapon slots to its right. Empty slots are a die line with no stock — an
unpeeled space. The primary action is whichever slot is empty, and it is the
only thing on the page that invites a tap.

FORM: Candidate 3 of seven grounded directions, chosen by the roll; seed key
3a31b5b6, mode experience. The sticker library came from the user's own read of
direction 5; Gumball Fields was chosen from five palettes against four others.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
