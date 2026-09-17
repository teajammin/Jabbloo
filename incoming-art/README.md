# Artwork waiting to be made into sprites

Drop pictures in here and run:

    node scripts/prepare-art.mjs        # --dry to see what it would do first

Each file is matched to a sprite by its name — `fire.webp` becomes the `fire`
effect. Names that do not match are listed and skipped rather than guessed at;
the handful that mean something different to the game than to the person who
named them are listed in `ALIASES` at the top of that script.

What the script does to each one: removes the background by flooding inward
from the edges, trims to what is left, scales it so its longest edge is 320px,
and hands off to `compress-effects.mjs`, which encodes it both lossless and
lossy and keeps whichever came out smaller.

The originals stay here at full size. The sprites that ship are downscaled and
cut out, so re-cutting one — a different tolerance, a bigger size — needs the
picture as it arrived.
