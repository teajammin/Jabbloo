import type { Request, Response } from 'express';

/**
 * Background removal proxy.
 *
 * Exists so the Remove.bg key stays server-side, the same reason the
 * choreographer runs here. The client posts a data URL and gets one back.
 *
 * Without a key configured this reports `available: false` rather than
 * failing, so the client can fall back to its local cutout and players are
 * never blocked by a missing credential.
 */

const ENDPOINT = 'https://api.remove.bg/v1.0/removebg';
/** Remove.bg rejects anything larger; also keeps a phone upload sane. */
const MAX_BYTES = 12 * 1024 * 1024;

export function cutoutAvailable(): boolean {
  return Boolean(process.env.REMOVEBG_API_KEY);
}

export async function cutout(req: Request, res: Response): Promise<void> {
  const key = process.env.REMOVEBG_API_KEY;
  if (!key) {
    res.json({ available: false, reason: 'no key configured' });
    return;
  }

  const dataUrl = typeof req.body?.image === 'string' ? req.body.image : '';
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    res.status(400).json({ error: 'expected a png, jpeg or webp data URL' });
    return;
  }

  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.byteLength > MAX_BYTES) {
    res.status(413).json({ error: 'image too large' });
    return;
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
      res.json({ available: false, reason: `remove.bg ${response.status}` });
      return;
    }

    const out = Buffer.from(await response.arrayBuffer());
    res.json({
      available: true,
      image: `data:image/png;base64,${out.toString('base64')}`,
    });
  } catch (error) {
    console.error('[cutout]', error);
    res.json({ available: false, reason: 'request failed' });
  }
}
