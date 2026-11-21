# Contributing to SyncReel

Thanks for helping improve SyncReel!

## Local Development

```bash
npm install
npm run build --workspace=@syncreel/shared
npm run dev
```

- Web UI runs on `http://localhost:5173` (proxying `/api` and `/ws` to `:3000`).
- Fastify server runs on `http://localhost:3000`.

### Solo Multi-Viewer Testing
You can test multi-viewer features (Swipe Match, Ready Check, Movie Polls, Host-Only locks, buffering recovery) locally in one browser:
1. Create a screening room as Host in Tab 1.
2. In the **Room** tab, click **Open Guest Preview Tab** (`/room/:code?asGuest=1`), which runs an isolated guest session in `sessionStorage` respecting all guest security rules.

## Quality Checks
Before opening a pull request, make sure all checks pass:

```bash
npm run typecheck
npm test
npm run build
```

## Guidelines
- Keep `packages/shared` and `apps/server` strictly ESM-compatible (`import ... from './file.js'`).
- Never expose `X-Plex-Token` to clients or embed it in rewritten `.m3u8` URLs.
- Keep guest routes strictly scoped to the active room.
