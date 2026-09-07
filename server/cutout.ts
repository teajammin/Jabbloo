/**
 * Background removal, via Remove.bg.
 *
 * Exists so the key stays server-side, the same reason the choreographer runs
 * there. Written against fetch, FormData and base64 helpers that both runtimes
 * have, so the deployed worker cuts subjects out exactly as the dev server
 * does rather than quietly losing the feature in production.
 *
 * Without a key it reports `available: false` instead of failing, and the
 * client falls back to its own edge-flood cutout — a player is never blocked
 * by a missing credential.
 */

const ENDPOINT = 'https://api.remove.bg/v1.0/removebg';
/** Remove.bg rejects anything larger; also keeps a phone upload sane. */
const MAX_BYTES = 12 * 1024 * 1024;

export interface CutoutResult {
  status: number;
  body: { available: boolean; image?: string; reason?: string; error?: string };
}

const bytesFrom = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  // Backed by a plain ArrayBuffer explicitly: a Blob part cannot be a view
  // over shared memory, and TypeScript is right to insist on the difference.
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

const base64From = (bytes: Uint8Array): string => {
  // Chunked: a single spread of a few megabytes overflows the call stack.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export interface CutoutConfig {
  /** Remove.bg key, for the hosted service. */
  removeBgKey: string;
  /** A rembg server running beside the game, if there is one. */
  rembgUrl: string;
}

export async function cutoutImage(
  dataUrl: unknown, config: CutoutConfig,
): Promise<CutoutResult> {
  const { removeBgKey: key, rembgUrl } = config;
  if (!key && !rembgUrl) {
    return { status: 200, body: { available: false, reason: 'no cutout service configured' } };
  }

  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(
    typeof dataUrl === 'string' ? dataUrl : '',
  );
  if (!match) {
    return {
      status: 400,
      body: { available: false, error: 'expected a png, jpeg or webp data URL' },
    };
  }

  const bytes = bytesFrom(match[2]!);
  if (bytes.byteLength > MAX_BYTES) {
    return { status: 413, body: { available: false, error: 'image too large' } };
  }

  // Local first: unmetered, private, and fast on the machine already hosting
  // the game. A service is the fallback rather than the other way round.
  if (rembgUrl) {
    const local = await viaRembg(bytes, match[1]!, rembgUrl);
    if (local) return local;
  }

  if (!key) {
    return { status: 200, body: { available: false, reason: 'local cutout unavailable' } };
  }

  try {
    const form = new FormData();
    form.append('image_file', new Blob([bytes]), `upload.${match[1]}`);
    form.append('size', 'auto');
    // Players draw people, pets and objects; letting the service decide beats
    // guessing wrong and cropping a character in half.
    form.append('type', 'auto');

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-Api-Key': key },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`[cutout] remove.bg ${response.status}: ${detail.slice(0, 200)}`);
      // Not an error to the client: it falls back locally and the player
      // still gets a usable image.
      return {
        status: 200,
        body: { available: false, reason: `remove.bg ${response.status}` },
      };
    }

    const out = new Uint8Array(await response.arrayBuffer());
    return {
      status: 200,
      body: { available: true, image: `data:image/png;base64,${base64From(out)}` },
    };
  } catch (error) {
    console.error('[cutout]', error);
    return { status: 200, body: { available: false, reason: 'request failed' } };
  }
}

/**
 * The local cutout service, if it is up.
 *
 * Two shapes are tried. First `POST /cutout` with the raw image bytes, which
 * is the service in `scripts/cutout-server.py` — no multipart encoding on
 * either side, which is one fewer thing to go wrong and the reason that script
 * exists at all. Failing that, the multipart endpoint a stock rembg server
 * exposes, so REMBG_URL can point at one of those instead.
 *
 * Returns null rather than an error when neither answers, so a laptop running
 * the game without the service falls through to whatever else is configured.
 * Nobody should lose a photo because a side process was not started.
 */
async function viaRembg(
  bytes: Uint8Array<ArrayBuffer>, format: string, base: string,
): Promise<CutoutResult | null> {
  // The model runs on a CPU: a large photo takes a couple of seconds, and a
  // phone waiting is better than a phone told it failed.
  const timeout = () => AbortSignal.timeout(30_000);

  const attempts: (() => Promise<Response>)[] = [
    () => fetch(`${base}/cutout`, {
      method: 'POST',
      headers: { 'Content-Type': `image/${format}` },
      body: bytes,
      signal: timeout(),
    }),
    () => {
      const form = new FormData();
      form.append('file', new Blob([bytes]), `upload.${format}`);
      return fetch(`${base}/api/remove`, { method: 'POST', body: form, signal: timeout() });
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await attempt();
      if (!response.ok) continue;
      const out = new Uint8Array(await response.arrayBuffer());
      return {
        status: 200,
        body: { available: true, image: `data:image/png;base64,${base64From(out)}` },
      };
    } catch (error) {
      console.warn('[cutout] local service:',
        error instanceof Error ? error.message : String(error));
    }
  }

  return null;
}
