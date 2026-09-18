"""
Finds a real photograph for each effect and makes a sprite of it.

The drawn artwork had to be guessed out of its background, and the guessing
showed. A photograph cannot be keyed at all — a real backdrop has shadow,
gradient and texture — so this uses a matting model instead, which is what the
job actually needs.

Two things matter more than the cutting:

Licensing. Only public-domain and CC0 files are taken, so nothing here carries
an attribution obligation or a share-alike string. The licence, author and
source page of every file are recorded in photo-credits.json regardless —
provenance you cannot reconstruct later is provenance you do not have.

Knowing when it failed. A search returns whatever it returns, and the model is
happy to find no subject at all in a photograph that is nothing but subject.
So every candidate is measured before it is accepted: how much of the frame the
subject occupies, how extreme its shape is, how big it is. Anything that fails
is rejected and the next candidate tried, and a sprite that never found a
usable photo is reported rather than quietly left as it was.

    .venv/bin/python scripts/photo-sprites.py [--only fish,pan] [--dry]
"""
import argparse
import base64
import hashlib
import io
import json
import os
import sys
import time
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

import certifi

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EFFECTS = ROOT / "public" / "effects"
MODEL = Path.home() / ".rembg" / "models" / "u2net" / "u2net.onnx"
CREDITS = ROOT / "public" / "photo-credits.json"
AGENT = "Jabbloo-art-sourcing/1.0 (party game sprite sourcing; contact via repo)"

# The longest edge a sprite ships at, matching the rest of the artwork.
MAX_EDGE = 320

# Only these. Anything else carries an obligation — attribution, share-alike —
# that a game handing sprites to strangers cannot reliably honour.
FREE_LICENCES = ("cc0", "public domain", "pd-", "no restrictions", "publicdomain")

# Left alone on request, plus everything too abstract to photograph: an impact
# flash, a shockring, a puff of confusion. Those stay as drawn.
KEEP = {
    # Left alone on request.
    "rock", "kiss", "banana", "confetti", "shield",

    # Too abstract to photograph: an impact flash, a shockring, a puff of
    # confusion. These are notation, not things.
    "impact", "sparkle", "dizzy", "whoosh", "stars", "crack", "slash",
    "confused", "alert", "beam", "charge", "soundwave", "shockring",
    "note", "wind", "stink", "poop", "sweat", "star", "sun", "heart", "hearts",

    # Not objects either, which is a different problem and took a run to see.
    # Fire, smoke and a breaking wave have no edge to cut along: a photograph
    # of them is a photograph of a whole scene, and any honest test of "one of
    # it, whole, nothing else around it" rejects every candidate — correctly.
    # The hand-drawn versions of these are the right answer and already exist.
    "fire", "smoke", "dust", "splash", "wave", "rain", "tornado", "bolt", "slime",
}

# What to search for, per sprite. The wording is doing real work: "isolated"
# and "white background" pull studio shots, which cut out far better than a
# thing photographed where it happens to live.
# What to search for, per sprite, in order of preference.
#
# More than one wording because a search is not a lookup: "frying pan" on
# Openverse is mostly Frying Pan Spring in Yellowstone, and the pictures are
# of bison. A second and third phrasing costs nothing and rescues most of
# the words that turn out to be place names or idioms.
QUERIES = {
    "fire": ["campfire flames", "bonfire", "fire flame"],
    "ice": ["icicle", "ice cube macro", "block of ice"],
    "bullet": ["ammunition cartridge", "bullets rounds", "rifle ammunition"],
    "arrow": ["arrowhead", "arrow archery target", "crossbow bolt"],
    "pebble": ["beach pebbles", "smooth stones", "river rock stone"],
    "splash": ["water splash", "splashing water", "water droplet splash"],
    "bolt": ["lightning strike sky", "lightning storm night", "forked lightning"],
    "coin": ["gold coin", "coin", "coins money"],
    "snowflake": ["snowflake", "snow crystal", "snowflake macro"],
    "leaf": ["green leaf", "leaf", "maple leaf"],
    "slime": ["green slime goo", "slime substance", "goo liquid"],
    "tooth": ["tooth", "human tooth", "molar tooth"],
    "wave": ["ocean wave", "breaking wave", "sea wave"],
    "dust": ["dust storm desert", "dust cloud ground", "sand dust blowing"],
    "smoke": ["smoke", "smoke plume", "smoke cloud"],
    "rain": ["rain drops window", "rainfall water", "rain droplets"],
    "tornado": ["tornado funnel storm", "waterspout", "funnel cloud storm"],
    "drone": ["quadcopter", "uav drone aircraft", "dji drone"],
    "meteor": ["meteorite", "meteor", "space rock meteorite"],
    "anvil": ["anvil blacksmith", "anvil iron forge", "blacksmithing anvil"],
    "piano": ["grand piano photograph", "piano instrument", "upright piano"],
    "bomb": ["hand grenade", "aerial bomb museum", "mortar shell"],
    "safe": ["safe strongbox", "vault safe", "steel safe"],
    "cheese": ["cheese wedge", "cheese", "cheese block"],
    "fish": ["single fish", "fish", "trout fish"],
    "fist": ["clenched fist photo", "fist hand punch", "closed fist"],
    "boot": ["rubber boot", "wellington boot", "leather boot"],
    "pan": ["frying pan cooking", "skillet", "cast iron skillet"],
    "clock": ["alarm clock", "clock", "wall clock"],
    "bubble": ["soap bubble", "bubble", "bubbles floating"],
}


# This Python has no system trust store wired up, so every https fetch fails
# on an unverifiable certificate. certifi ships the CA bundle; point at it
# rather than at the alternative, which is turning verification off.
TRUST = ssl.create_default_context(cafile=certifi.where())


CACHE = ROOT / ".art-cache"


def get(url: str, tries: int = 4) -> bytes:
    """
    Fetches a URL, politely, with a name attached, and only once ever.

    Cached on disk because this script is run over and over while its queries
    and its standards are tuned, and every one of those runs was spending a
    public API's anonymous quota on questions it had already asked. The third
    run got nothing back at all — every search a 429 — which reads exactly
    like "no public-domain photo exists" and is not that at all.
    """
    CACHE.mkdir(exist_ok=True)
    key = CACHE / (hashlib.sha256(url.encode()).hexdigest()[:40] + ".bin")
    if key.exists():
        return key.read_bytes()

    last = None
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=45, context=TRUST) as response:
                body = response.read()
            key.write_bytes(body)
            return body
        except Exception as error:  # noqa: BLE001 — every failure means try again
            last = error
            # A rate limit wants a real pause, not a polite one.
            rated = "429" in str(error) or "Too Many" in str(error)
            time.sleep((8.0 if rated else 1.5) * (attempt + 1))
    raise RuntimeError(f"{url[:70]}: {last}")


def is_free(licence: str) -> bool:
    """Whether a licence string means nobody has to be credited or asked."""
    low = licence.lower()
    return any(token in low for token in FREE_LICENCES)


def search(query: str, limit: int = 24) -> list[dict]:
    """
    Candidate photographs for a query, with their licensing attached.

    Openverse rather than Commons directly: it aggregates Flickr, the museums
    and Commons itself, and — the part that matters — filters by licence at
    the source. Commons is mostly share-alike, and asking it for public-domain
    photographs of ordinary objects turns up almost nothing.
    """
    url = (
        "https://api.openverse.org/v1/images/?q=" + urllib.parse.quote(query) +
        "&license=cc0,pdm&page_size=" + str(limit) + "&mature=false"
    )
    results = json.loads(get(url)).get("results", [])
    out = []
    for item in results:
        if not item.get("url"):
            continue
        out.append({
            "title": (item.get("title") or "untitled")[:70],
            "url": item["url"],
            "page": item.get("foreign_landing_url") or item.get("url"),
            "licence": (item.get("license") or "").upper(),
            "author": (item.get("creator") or "unknown")[:80],
            "provider": item.get("provider") or "?",
        })
    return out


def search_commons(query: str, limit: int = 50) -> list[dict]:
    """
    The same question asked of Wikimedia Commons.

    Openverse is the better index but has an anonymous quota that a script
    tuning its own queries exhausts quickly. Commons has no such limit and a
    deep public-domain collection — old books, government work, museum
    uploads — it is just buried under a much larger share-alike majority, so
    this asks for far more results and throws most of them away.
    """
    url = (
        "https://commons.wikimedia.org/w/api.php?action=query&format=json"
        "&generator=search&gsrnamespace=6&gsrlimit=" + str(limit) +
        "&gsrsearch=" + urllib.parse.quote(query + " filetype:bitmap") +
        "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1000"
    )
    pages = json.loads(get(url)).get("query", {}).get("pages", {})
    out = []
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        licence = meta.get("LicenseShortName", {}).get("value", "")
        if not is_free(licence) or not info.get("thumburl"):
            continue
        out.append({
            "title": page["title"].replace("File:", "")[:70],
            "url": info["thumburl"],
            "page": info.get("descriptionurl", ""),
            "licence": licence.upper(),
            "author": strip_tags(meta.get("Artist", {}).get("value", "")) or "unknown",
            "provider": "wikimedia",
        })
    return out


def find(query: str) -> list[dict]:
    """Candidates from whichever index will answer."""
    found = []
    for source in (search, search_commons):
        try:
            found.extend(source(query))
        except Exception as error:  # noqa: BLE001
            print(f"          ({source.__name__} {query!r}: {str(error)[-40:]})")
    return found


def strip_tags(html: str) -> str:
    """Commons returns author fields as HTML; the sheet wants a name."""
    out, depth = [], 0
    for char in html:
        if char == "<":
            depth += 1
        elif char == ">":
            depth -= 1
        elif depth == 0:
            out.append(char)
    return " ".join("".join(out).split())[:80]


class Matte:
    """The cutout model, loaded once."""

    def __init__(self, path: Path):
        self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name

    def mask(self, image: Image.Image) -> np.ndarray:
        """A soft mask of whatever the picture is actually of, 0..1."""
        small = image.convert("RGB").resize((320, 320), Image.LANCZOS)
        x = np.asarray(small, np.float32) / 255.0
        x = x / max(x.max(), 1e-6)
        x = (x - np.array([0.485, 0.456, 0.406], np.float32)) \
            / np.array([0.229, 0.224, 0.225], np.float32)
        x = x.transpose(2, 0, 1)[None].astype(np.float32)
        d = self.session.run(None, {self.input: x})[0][0][0]
        d = (d - d.min()) / max(d.max() - d.min(), 1e-6)
        return np.asarray(
            Image.fromarray((d * 255).astype(np.uint8)).resize(image.size, Image.LANCZOS),
            np.float32,
        ) / 255.0


def make_sprite(image: Image.Image, mask: np.ndarray) -> Image.Image | None:
    """Applies the mask, trims to the subject and scales it to sprite size."""
    rgba = image.convert("RGBA")
    alpha = np.clip((mask - 0.30) / 0.45, 0, 1)  # firm up the middle, keep the edge soft
    arr = np.dstack([np.asarray(rgba)[:, :, :3], (alpha * 255).astype(np.uint8)])
    cut = Image.fromarray(arr, "RGBA")

    box = cut.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if box is None:
        return None
    cut = cut.crop(box)

    w, h = cut.size
    scale = min(1.0, MAX_EDGE / max(w, h))
    return cut.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def judge(mask: np.ndarray, sprite: Image.Image | None) -> str | None:
    """Why this candidate is no good, or None if it is fine."""
    if sprite is None:
        return "nothing found in it"
    share = float((mask > 0.5).mean())
    if share < 0.03:
        return f"no clear subject ({share:.1%} of frame)"
    if share > 0.80:
        return f"subject is the whole frame ({share:.0%}), nothing to cut from"
    w, h = sprite.size
    if max(w, h) / max(1, min(w, h)) > 4.2:
        return f"extreme shape ({w}x{h})"
    if max(w, h) < 120:
        return f"too small ({w}x{h})"
    solid = (np.asarray(sprite.getchannel("A")) > 200).mean()
    if solid > 0.95:
        return f"fills its own box ({solid:.0%}) — the cut did nothing"
    return None


class Eyes:
    """
    Asks whether a finished sprite is actually the thing it claims to be.

    Search relevance cannot be measured from the pixels. A photograph of a
    bison is a fine photograph with a clear subject, and every numeric check
    passes it — it is simply not a frying pan, and "frying pan" matched a
    hot spring in Yellowstone named after one. Nor can a bad matte be caught
    by counting: a cutout with half the handle missing has perfectly
    reasonable statistics.

    So the finished sprite is shown to a model, which answers both questions
    at once. Cheap, and the only check here that looks at the picture rather
    than at numbers about it.
    """

    MODEL = "claude-haiku-4-5-20251001"

    def __init__(self, key: str):
        import anthropic
        self.client = anthropic.Anthropic(api_key=key)

    def judge(self, sprite: Image.Image, thing: str) -> tuple[bool, str]:
        # Small: the question is "what is this and is it clean", which does not
        # need resolution, and a big image is a slower, dearer call.
        shown = sprite.copy()
        shown.thumbnail((320, 320))
        flat = Image.new("RGB", shown.size, (255, 255, 255))
        flat.paste(shown, mask=shown.getchannel("A"))
        buffer = io.BytesIO()
        flat.save(buffer, "JPEG", quality=80)

        message = self.client.messages.create(
            model=self.MODEL,
            max_tokens=100,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {
                        "type": "base64", "media_type": "image/jpeg",
                        "data": base64.b64encode(buffer.getvalue()).decode(),
                    }},
                    {"type": "text", "text": (
                        f"This is meant to be a game sprite of: {thing}.\n\n"
                        "It has been cut out of a photograph, so it sits on white "
                        "with nothing else around it.\n\n"
                        "Answer GOOD only if ALL of these hold:\n"
                        "- it is a PHOTOGRAPH of a real object. A drawing, painting, "
                        "illustration, sticker, clip art, diagram, logo or 3D render "
                        "is BAD, however well made.\n"
                        "- it is the thing ITSELF, not something merely named after "
                        "it. An aircraft called a Tornado is not a tornado; a jet "
                        "called a Lightning is not lightning; a place called Frying "
                        "Pan is not a frying pan.\n"
                        "- there is ONE of it, whole, and recognisable on its own at "
                        "small size. A pile or group is BAD. A person holding it is "
                        "BAD. Leftover scenery or background fragments are BAD.\n"
                        "Answer BAD otherwise.\n\n"
                        "Reply with exactly: GOOD or BAD, then a dash and at most "
                        "eight words saying what you actually see."
                    )},
                ],
            }],
        )
        reply = message.content[0].text.strip()
        return reply.upper().startswith("GOOD"), reply[:80]


def read_key() -> str:
    """The key out of .env.local, which is where this project keeps it."""
    path = ROOT / ".env.local"
    if not path.exists():
        return ""
    for line in path.read_text().splitlines():
        if line.startswith("ANTHROPIC_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"\'')
    return ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated sprite ids")
    parser.add_argument("--dry", action="store_true")
    parser.add_argument("--no-check", action="store_true",
                        help="skip the vision check (faster, and much worse)")
    args = parser.parse_args()

    if not MODEL.exists():
        print(f"no matting model at {MODEL}", file=sys.stderr)
        return 1

    wanted = [w.strip() for w in args.only.split(",") if w.strip()] or sorted(QUERIES)
    skipped = [w for w in wanted if w in KEEP]
    wanted = [w for w in wanted if w not in KEEP]
    if skipped:
        print(f"leaving alone: {', '.join(skipped)}\n")

    matte = Matte(MODEL)

    eyes = None
    if not args.no_check:
        key = os.environ.get("ANTHROPIC_API_KEY") or read_key()
        if key:
            eyes = Eyes(key)
        else:
            print("no ANTHROPIC_API_KEY — running without the relevance check,\n"
                  "which means nothing verifies the photo is of the right thing\n")
    credits = json.loads(CREDITS.read_text()) if CREDITS.exists() else {}
    done, failed = 0, []

    for sprite_id in wanted:
        wordings = QUERIES.get(sprite_id)
        if not wordings:
            print(f"  --    {sprite_id}: nothing to search for")
            continue

        """
        Each wording's results interleaved rather than stacked.

        Stacked, a first wording that returns twenty irrelevant pictures buries
        the second wording's good ones past wherever the list is cut off — and
        the first wording is exactly the one likely to be a place name. Taking
        turns means every phrasing gets its best guesses considered.
        """
        per_wording = []
        for wording in wordings:
            try:
                per_wording.append(find(wording))
            except Exception as error:  # noqa: BLE001
                print(f"        {sprite_id}: search {wording!r} failed — {error}")

        candidates, seen_urls = [], set()
        for rank in range(max((len(r) for r in per_wording), default=0)):
            for results in per_wording:
                if rank >= len(results):
                    continue
                candidate = results[rank]
                if candidate["url"] in seen_urls:
                    continue
                seen_urls.add(candidate["url"])
                candidates.append(candidate)

        if not candidates:
            print(f"  FAIL  {sprite_id}: no public-domain photo found")
            failed.append(sprite_id)
            continue

        query = wordings[0]
        placed = False
        for candidate in candidates[:26]:
            try:
                image = Image.open(io.BytesIO(get(candidate["url"])))
                image.load()
            except Exception as error:  # noqa: BLE001
                print(f"        {sprite_id}: could not read {candidate['title'][:32]} — {error}")
                continue

            mask = matte.mask(image)
            sprite = make_sprite(image, mask)
            complaint = judge(mask, sprite)
            if complaint:
                print(f"        {sprite_id}: rejected {candidate['title'][:34]} — {complaint}")
                continue

            seen = ""
            if eyes is not None:
                try:
                    ok, seen = eyes.judge(sprite, query.split(" isolated")[0].split(" on ")[0])
                except Exception as error:  # noqa: BLE001
                    ok, seen = True, f"(not checked: {type(error).__name__})"
                if not ok:
                    print(f"        {sprite_id}: rejected — {seen}")
                    continue

            if not args.dry:
                sprite.save(EFFECTS / f"{sprite_id}.png")
            credits[sprite_id] = {
                "seen_as": seen,
                "provider": candidate.get("provider", "?"),
                "title": candidate["title"],
                "licence": candidate["licence"],
                "author": candidate["author"],
                "source": candidate["page"],
            }
            # Written now rather than at the end: a run that is interrupted
            # otherwise leaves sprites on disk whose licence and source were
            # only ever in memory, which is artwork of unknown provenance —
            # the one thing this script exists to prevent.
            if not args.dry:
                CREDITS.write_text(json.dumps(credits, indent=2, sort_keys=True) + "\n")

            print(f"  ok    {sprite_id:11s} {sprite.size[0]:3d}x{sprite.size[1]:<3d} "
                  f"{candidate['licence']:5s} {candidate['title'][:32]:34s} {seen[:40]}")
            placed = True
            done += 1
            break

        if not placed:
            print(f"  FAIL  {sprite_id}: {len(candidates)} candidates, none usable")
            failed.append(sprite_id)

    if not args.dry:
        CREDITS.write_text(json.dumps(credits, indent=2, sort_keys=True) + "\n")

    print(f"\n{done} placed, {len(failed)} unfilled")
    if failed:
        print("still drawn rather than photographed: " + ", ".join(failed))
    if args.dry:
        print("(dry run — nothing written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
