# Deployment Guide

SyncReel is packaged as a single Node.js 22 container serving both the Fastify API/WebSocket backend and the built React 19 PWA frontend on port `3000`.

---

## 1. Docker Compose + Local Plex Server

### Standard Compose

```bash
cp .env.example .env
# Edit PUBLIC_URL if needed (or leave defaults and proxy via HTTPS)
docker compose up -d --build
```

### Reaching Plex Running on the Same Host
If Plex runs natively on the Docker host (port `32400`) instead of inside another container on the same Docker network:

- **Windows / macOS Docker Desktop**: `http://host.docker.internal:32400` works out of the box.
- **Linux Docker Engine**: Add `extra_hosts` in `docker-compose.yml` or create a gitignored `docker-compose.override.yml`:

  ```yaml
  services:
    syncreel:
      extra_hosts:
        - "host.docker.internal:host-gateway"
  ```

---

## 2. Reverse Proxy Setup (Required for Production HTTPS)

HTTPS is required for:
- `Secure` HTTP-only host/guest session cookies (when `PUBLIC_URL` starts with `https://`)
- Installable Progressive Web App (PWA) service worker registration
- Google Cast Web Sender integration

### Option A — Caddy (Recommended)

See [`deploy/Caddyfile.example`](../deploy/Caddyfile.example). Caddy handles automatic TLS, WebSocket upgrades (`/ws`), and unbuffered HLS streaming when `flush_interval -1` is set:

```caddyfile
watch.example.com {
    encode zstd gzip

    reverse_proxy syncreel:3000 {
        flush_interval -1
    }
}
```

### Option B — Nginx

See [`deploy/nginx.conf.example`](../deploy/nginx.conf.example). Make sure `proxy_buffering off;` is enabled so HLS chunks stream without stalling, and configure the `/ws` location block with `Upgrade` / `Connection "upgrade"` headers and extended read/send timeouts (`3600s`).

### Option C — Cloudflare Tunnel (No Router Port Forwarding)

If your ISP uses CG-NAT or you prefer not to expose ports `80`/`443` on your router:
1. Bind SyncReel only to localhost or an internal Docker network (e.g., `127.0.0.1:3000:3000` or via your internal proxy container).
2. In Cloudflare Zero Trust → Tunnels, create a Published Application Route:
   - Hostname: `watch.example.com`
   - Service: `http://syncreel:3000` (or `https://caddy:443` if fronting through Caddy inside the same Docker network)
3. Set `PUBLIC_URL=https://watch.example.com` in SyncReel's `.env` so invite links and `Secure` cookies use HTTPS cleanly.

### Optional — Built-In Cloudflare DDNS Profile

If you expose HTTPS directly through your router on a dynamic IP, `docker-compose.yml` includes an optional `ddns` profile using `favonia/cloudflare-ddns`:

```bash
# Set CLOUDFLARE_API_TOKEN (Zone -> DNS -> Edit) and DOMAIN=watch.example.com in .env
docker compose --profile ddns up -d
```

---

## 3. Data Persistence & Upgrades

SyncReel stores all runtime secrets and encrypted configuration inside `DATA_DIR` (`/data` inside Docker):
- `/data/secret.key` — auto-generated 64-character hex master secret (mode `0600`).
- `/data/state.json` — atomic AES-256-GCM encrypted file holding your Plex server owner token, shared friend tokens (if enabled), webhook settings, and room defaults.

To upgrade while preserving configuration:

```bash
docker compose pull   # or docker compose up -d --build
docker compose up -d
```

> [!WARNING]
> Do not delete the `syncreel_data` Docker volume (or `/data/secret.key`) without re-running the Setup Wizard — `state.json` is encrypted using that key.

---

## 4. Troubleshooting

| Symptom | Likely Cause & Fix |
|---|---|
| Host login works in Setup Wizard, then disappears on reload | Accessing via plain HTTP while `PUBLIC_URL=https://...` is set (`Secure` cookie won't be sent over HTTP), or missing `X-Forwarded-Proto` in reverse proxy. |
| "Reachable Plex URL not found" in Setup Wizard | Plex container cannot reach `localhost:32400`. Use `http://host.docker.internal:32400` or your host LAN IP (e.g. `http://192.168.1.50:32400`). |
| Video plays cleanly for Host, stalls on proxy | Reverse proxy buffering is enabled, or upstream firewall limits long-lived `.ts`/`.m4s` chunk responses. Set `flush_interval -1` (Caddy) or `proxy_buffering off` (Nginx). |
| Guest can watch in Chrome desktop, Chromecast button missing | Chromecast Web Sender requires a valid `https://` origin and Google Chrome / Chromium-based browser on the same LAN as the Cast device. |
