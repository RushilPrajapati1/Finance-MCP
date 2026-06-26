/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default FinLedger API key for local dev (see web/.env.local). Optional. */
  readonly VITE_FINLEDGER_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
