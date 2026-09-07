// Must come first: it loads the environment during the import phase, before
// any module below constructs a client that reads a key.
import './env';
import express from 'express';
import { networkInterfaces } from 'node:os';
import { handleApi } from './api';
import { readConfig } from './ai';

/**
 * The development host.
 *
 * A thin shell around `handleApi`, which is the actual API and is shared with
 * the deployed worker — so what is exercised here in development is the same
 * code that runs in production, rather than its twin.
 */

const app = express();
// Drawings arrive as data URLs, which are large; the default 100kb limit
// rejects a photo before it is ever looked at.
app.use(express.json({ limit: '25mb' }));

const PORT = Number(process.env.PORT ?? 8787);

/**
 * The address a phone should use to reach this host.
 *
 * Development only, and deliberately so: the browser cannot see the machine's
 * network address — `location.host` on the laptop is `localhost`, which is
 * exactly what a phone cannot use. In production the site is served from a
 * real hostname and the question does not arise.
 */
app.get('/api/lan', (_req, res) => {
  const port = Number(process.env.WEB_PORT ?? 5173);
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // IPv4 only, and nothing loopback or link-local: a phone needs an
      // address it can actually route to.
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      addresses.push(`${entry.address}:${port}`);
    }
  }
  res.json({ hosts: addresses });
});

app.all('/api/*splat', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await handleApi(req.path, body, process.env);
    if (!result) {
      res.status(404).json({ error: 'no such endpoint' });
      return;
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[api]', error);
    res.status(500).json({ error: 'request failed' });
  }
});

app.listen(PORT, () => {
  const config = readConfig(process.env);
  const keyed = config.apiKey ? 'key loaded' : 'NO KEY — set ANTHROPIC_API_KEY in .env.local';
  console.log(`Choreographer listening on http://localhost:${PORT} (${keyed})`);
});
