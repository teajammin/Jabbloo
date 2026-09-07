import { config } from 'dotenv';

/**
 * Loads the environment before anything else does.
 *
 * A module of its own because import statements are evaluated before any of
 * the importing file's body: loading dotenv in `index.ts` would run *after*
 * the Anthropic client was constructed, and it would come up without a key.
 * Importing this first makes the load part of the import phase.
 *
 * Secrets live in `.env.local`, everything else in `.env`. The split exists
 * because PartyKit reads `.env` when it deploys the multiplayer room, and that
 * room needs no keys at all — so keeping the API keys in a file it never reads
 * means a deploy cannot carry them off this machine. dotenv never overwrites
 * what is already set, so the secret file is loaded first and wins.
 */
config({ path: '.env.local' });
config();
