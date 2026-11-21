<p align="center">
  <img src="./docs/banner.svg" alt="SyncReel — Self-Hosted Watch Together for Plex" width="100%" />
</p>

<p align="center">
  <strong>Self-hosted screening rooms for your Plex Media Server.</strong><br />
  Send one link, pick a movie or show together with Tinder-style <strong>Swipe Match</strong>, and watch in sub-second sync across browsers, phones, AirPlay, Chromecast, and Smart TVs — <strong>without requiring guests to own a Plex account or Remote Watch Pass</strong>.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-E5A00D?style=for-the-badge" alt="MIT License" /></a>
  <a href="#-100-ai--vibe-coded-transparency"><img src="https://img.shields.io/badge/Built_With-100%25_AI_%2F_Vibe--Coded-a855f7?style=for-the-badge" alt="100% AI / Vibe-Coded" /></a>
  <a href="https://github.com/martion289/syncreel/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/martion289/syncreel/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI Status" /></a>
  <a href="https://github.com/martion289/syncreel/releases"><img src="https://img.shields.io/github/v/release/martion289/syncreel?style=for-the-badge&color=E5A00D" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/Docker-amd64%20%7C%20arm64-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Multi-Arch" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Strict" />
</p>

> [!NOTE]
> **Full Transparency — 100% AI / Vibe-Coded:** SyncReel was built from scratch as a **100% AI-generated ("vibe-coded")** open-source project, steered by human product direction, live homelab testing, and automated TypeScript + Vitest verification. See [100% AI / Vibe-Coded Transparency](#-100-ai--vibe-coded-transparency) below for details.

---

## Why SyncReel?

Plex retired its official **Watch Together** feature across apps in 2025, leaving Plex server owners looking for a fast, zero-friction replacement that actually works with mixed friend groups (mobile data, iOS Safari, Android Chrome, Chromecast, desktop browsers, and Smart TVs).

| Capability | Retired Plex Watch Together | **SyncReel** |
|---|---|---|
| Friends need Plex accounts / apps | Yes (every viewer) | **No** — invite link + display name |
| Works on mobile / web browsers | Limited / removed | **Yes** — installable PWA + HLS |
| Pick what to watch together | Manual out-of-band | **Tinder-style Swipe Match + Polls** |
| Vanity room URLs | No | **Yes** (`/room/friday-night`) + PIN |
| Bandwidth-saving shared transcode | No | **Yes** (Eco Shared Stream mode) |
| Custom subtitle styling & `±ms` offset | Limited | **Yes** (extracts MKV SRT/ASS → WebVTT) |
| Discord "Movie Night" embeds | No | **Yes** (SSRF-safe webhooks) |

---

## Features

- **Zero-Config Setup Wizard**: Boot the container with zero `.env` configuration. SyncReel auto-generates an encrypted `secret.key` in `/data`, authenticates the server owner via Plex OAuth PIN flow, and probes your Plex server connections with live latency checks.
- **Zero-Account Guest Invites & Vanity Rooms**: Share links like `/room/friday-night` (or a random 6-character code) with optional PIN protection. Guests enter a display name and start watching immediately — or optionally link their own Plex account to scrobble personal watch history.
- **Tinder-Style Swipe Match (Movies & TV Shows)**: Filter by library (`Movies`, `TV Shows`, or `All Libraries`), pick a genre or **Wildcard**, toggle `Unwatched only`, and deal cards to the room. Everyone receives the same deck in a private shuffled order, swipes with fluid touch/pointer physics (with fly-off animations, velocity flicks, peeking next poster, and slide-up synopsis), and unanimous likes collect in the **Matches** shortlist. TV show matches automatically start at the next unwatched episode (or `S01E01`).
- **Quick Movie Polls & Ready Check**: Host 2–6 title polls manually or with random library picks, then trigger a **Ready Check** with a synchronized **3 · 2 · 1** playback countdown.
- **Sub-Second Authoritative Sync + Buffering Recovery**: NTP-style clock offset estimation pairs with a 3-tier drift controller (deadband under `180ms`, gentle `0.95x–1.05x` rate nudge up to `1500ms`, hard seek above `1500ms`). If any viewer stalls, playback pauses for the room and automatically resumes when ready (or evicts stalled peers after a timeout).
- **Per-Viewer HLS OR Eco Shared Stream**: Give every viewer independent quality, audio track, and subtitle selection, or toggle **Eco Shared Stream** so the entire room shares a single Plex transcode session.
- **Embedded MKV Subtitles + Custom Styling & Offset**: Extracts embedded SRT/ASS text subtitles to WebVTT on the fly (no video burn-in required), with per-viewer font size, background opacity, and floating-point-drift-free `±5000ms` timing offset controls.
- **Fullscreen Floating Chat & Emoji Overlays**: When watching in Fullscreen or with the sidebar collapsed, incoming chat messages float unobtrusively in upper-right frosted glass bubbles (away from subtitles), emoji reactions and emoji-only messages float across the video, and an inline Quick Chat / Emoji bar (`On-screen: On/Off` toggle) lets viewers reply without leaving fullscreen.
- **AirPlay, Chromecast, PiP & Smart TV Mode**: Native Safari HLS AirPlay, Google Cast Default Receiver sync, Picture-in-Picture, OS Media Session lock-screen controls, installable mobile PWA, and TV remote navigation (`?tv=1`).
- **Discord / Webhook Alerts & Admin Panel**: Broadcast rich embeds when screening rooms open or switch titles, moderate guests (mute chat, kick, transfer host), and inspect or terminate active rooms and Plex transcode sessions from the built-in Admin modal.

---

## Architecture

```mermaid
flowchart LR
    H["Host Browser / PWA"] <-->|"WebSocket Sync + Control"| SR
    G["Guest Phone / TV / Cast<br/>(No Plex Account Needed)"] <-->|"WebSocket Sync + HLS Proxy"| SR
    subgraph SR["SyncReel Container (Fastify + React 19 PWA)"]
        WS["Authoritative Sync Engine<br/>& Swipe / Poll State"]
        SP["Stream & MKV Subtitle Proxy<br/>(Strips X-Plex-Token)"]
        ST["Encrypted State Store<br/>(AES-256-GCM /data/state.json)"]
    end
    SR <-->|"Plex API + HLS Transcode<br/>(Server-Side Token Only)"| PLEX["Plex Media Server"]
```

---

## 60-Second Quick Start (Docker Compose)

1. Save this minimal `docker-compose.yml` (or clone this repo and run directly):

   ```yaml
   services:
     syncreel:
       image: ghcr.io/martion289/syncreel:latest
       # Or build locally from source:
       # build: .
       container_name: syncreel
       restart: unless-stopped
       environment:
         NODE_ENV: production
         PORT: 3000
         DATA_DIR: /data
       ports:
         - "3000:3000"
       volumes:
         - syncreel_data:/data
       # Uncomment on Linux if Plex runs natively on the Docker host:
       # extra_hosts:
       #   - "host.docker.internal:host-gateway"

   volumes:
     syncreel_data:
   ```

2. Start SyncReel:

   ```bash
   docker compose up -d --build
   ```

3. Place SyncReel behind an **HTTPS reverse proxy** (Caddy, Nginx, Traefik, or Cloudflare Tunnel) — see [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) and [`deploy/`](./deploy).

   > [!IMPORTANT]
   > HTTPS is required in production for `Secure` session cookies, PWA installation, and Chromecast. On direct proxies (without Cloudflare proxy), disable response buffering (`flush_interval -1` in Caddy, `proxy_buffering off` in Nginx) so `.m3u8` / `.ts` streaming stays smooth.

4. Open `https://your-domain.example` and complete the 3-step **Setup Wizard**.

---

## Configuration & Environment Variables

All environment variables in [`.env.example`](./.env.example) are optional — SyncReel boots cleanly with defaults and persists owner auth/settings in encrypted storage.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container or dev server. |
| `PUBLIC_URL` | `""` | Public `https://...` origin used for `Secure` cookies, WebSocket origin checks, and webhook invite links. |
| `PLEX_URL` | `""` | Optional Plex Media Server URL fallback (normally set in the Setup Wizard). |
| `APP_SECRET` | Auto-generated | 64-char hex secret for AES-256-GCM state encryption & HMAC cookies. Auto-generated to `DATA_DIR/secret.key` if omitted. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Persistent directory for `secret.key` and `state.json`. |
| `CLIENT_IDENTIFIER` | `syncreel-plex-01` | Plex `X-Plex-Client-Identifier` reported to your Plex server. |
| `CLOUDFLARE_API_TOKEN` | `""` | Optional Cloudflare token (Zone → DNS → Edit) for the optional `--profile ddns` service in `docker-compose.yml`. |

---

## Keyboard & Smart TV Remote Shortcuts

### Video Player
| Key / Remote Button | Action |
|---|---|
| `Space`, `k`, `MediaPlayPause` | Play / Pause |
| `ArrowLeft`, `MediaRewind` | Seek back `10s` |
| `ArrowRight`, `MediaFastForward` | Seek forward `10s` |
| `f` | Toggle fullscreen |
| `m` | Toggle mute |
| `c` | Cycle embedded text subtitle tracks |
| `t` | Show / hide side panel (Chat, Up Next, Room) |
| `Escape` | Close player settings popover |

### Swipe Match Deck
| Key / Gesture | Action |
|---|---|
| Drag Left / `ArrowLeft` | Pass (`NOPE`) |
| Drag Right / `ArrowRight` | Vote Yes (`WATCH`) |
| `i` / Info button | Toggle slide-up plot synopsis |
| `Escape` | Close Swipe Match modal |

---

## Local Development & Solo Multi-Viewer Testing

### Run Locally

```bash
npm install
npm run build --workspace=@syncreel/shared
npm run dev
```

- **Web UI (Vite)**: `http://localhost:5173` (proxies `/api` and `/ws` to `:3000`)
- **API & WebSocket Server (Fastify)**: `http://localhost:3000`

### Quality & Test Suite

```bash
npm run typecheck   # Type-checks @syncreel/shared, @syncreel/server, and @syncreel/web
npm test            # Runs Vitest unit & security tests across server and web
npm run build       # Compiles shared library, Fastify server, and Vite PWA bundle
```

### Solo Multi-Viewer Testing
You can verify multi-viewer sync, Swipe Match voting, Movie Polls, Host-Only locks, and buffering recovery alone in one browser:
1. Create a screening room as Host in Tab 1.
2. Open the **Room** tab in the sidebar and click **Open Guest Preview Tab** (`/room/:code?asGuest=1`), which runs an isolated guest token in `sessionStorage`.
3. Swipe, vote, or trigger **Sim 4s Buffer** in Tab 2 to verify multi-user behavior locally.

---

## 🤖 100% AI / Vibe-Coded Transparency

SyncReel was conceived, architected, debugged, and polished **100% through AI-assisted / vibe coding** under human product direction and live Plex homelab verification.

What that means for self-hosters and contributors:
- **Verified Automatically, Still Inspect Before Trusting Blindly**: Every build runs strict TypeScript checks across `@syncreel/shared`, `@syncreel/server`, and `@syncreel/web`, plus Vitest unit and security integration tests (covering sync engine rules, SRT/ASS→WebVTT subtitle conversion, playlist token redaction, SSRF webhook blocking, guest isolation, and swipe physics).
- **Zero Guarantee Without Community Review**: While defensive security controls are built in (see [SECURITY.md](./SECURITY.md)), an AI-authored codebase benefits enormously from human eyes. Security audits, refactors, issue reports, and pull requests are **very welcome**!

---

## Contributing, Security & License

- **Deployment & Reverse Proxy Guide**: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- **Contributing Guide**: [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Security Policy**: [SECURITY.md](./SECURITY.md)
- **Changelog**: [CHANGELOG.md](./CHANGELOG.md)
- **License**: [MIT](./LICENSE)
