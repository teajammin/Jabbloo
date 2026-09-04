/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PartyKit host, e.g. "localhost:1999" in dev or a deployed party URL. */
  readonly VITE_PARTYKIT_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
