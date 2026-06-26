# Finance-Ledger — FinLedger web UI (REST client)

This repository contains the Vite + React web UI for FinLedger. It is a client that talks to the Finanace-MCP backend over the REST API (`/v1/*`). This repo contains no server-side accounting logic — it is strictly a frontend and must be pointed at a running FinLedger backend.

## What this app is

- Vite + React dashboard for ledger-driven portfolios: accounts, transactions, trial balance, and simulator for demo data.
- Client-only: all accounting guarantees and validation come from the backend.

## Local development

1. Ensure Finanace-MCP (backend) is running locally at `http://localhost:8000` and a tenant key exists.
2. Create a gitignored dev env file at `web/.env.local`:

   ```
   FINLEDGER_API_URL=http://localhost:8000
   FINLEDGER_API_KEY=<tenant key, keep this out of source control>
   ```

3. Install & run:

   ```
   npm install
   npm run dev   # http://localhost:5173
   ```

## Production / deployment

- The recommended production setup uses a server-side proxy (Vercel edge function or similar) that injects the tenant key server-side; the browser never receives the secret.
- On Vercel: set `FINLEDGER_API_KEY` and (optionally) `FINLEDGER_API_URL` in the Project Environment Variables (do not use the `VITE_` prefix for server-only vars).

## Security notes

- Never commit tenant keys or other secrets. Use platform environment variables or secret management. If a secret was ever committed, rotate it immediately.

## Project layout

```
src/
  api/         typed fetch client and types (contract with backend)
  lib/         money helpers (decimal handling)
  context/     configuration & API-key context
  components/  layout & UI
  pages/       Dashboard, Accounts, Transactions, Simulator, Settings
```

See the backend README in Finanace-MCP for deployment details and the API contract.
