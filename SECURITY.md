# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| `1.0.x` | Yes |
| `< 1.0` | No |

---

## Security Architecture

SyncReel is designed so you can invite friends without giving them access to your Plex credentials or broad server APIs:

1. **Zero Client-Side `X-Plex-Token` Exposure**: Your Plex owner token stays strictly on the SyncReel backend. Rewritten HLS `.m3u8` manifests and media proxy URLs strip upstream `X-Plex-Token` query parameters and route requests through room-scoped server endpoints.
2. **AES-256-GCM Encrypted Persistence**: `state.json` encrypts Plex owner and friend tokens using a key derived via `scrypt` from `APP_SECRET` (or auto-generated `/data/secret.key`).
3. **Room-Scoped Guest Sessions**: Zero-account guests receive HMAC-signed session tokens scoped strictly to the specific room code they joined. Guests cannot browse your Plex libraries, change admin settings, or view other rooms.
4. **SSRF-Protected Outbound Webhooks**: Webhook URLs (`https://` only) are validated before storage and delivery to block loopback, link-local, `.local` / `.internal`, and RFC 1918 private network addresses.
5. **WebSocket & HTTP Hardening**: WebSocket upgrades validate the `Origin` header against `PUBLIC_URL` / request `Host`, HTTP routes apply rate limiting (`@fastify/rate-limit`), and responses set `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a strict `Content-Security-Policy`.

---

## AI / Vibe-Coded Audit Disclosure

SyncReel was generated **100% with AI / vibe coding** alongside automated type checks and Vitest security unit tests. While core invariants (token redaction, guest scope, origin checks, webhook validation) are tested in CI, we strongly encourage independent security review before exposing any instance to untrusted public traffic.

---

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, please report findings privately using **GitHub Security Advisories** ("Security" → "Advisories" → "Report a vulnerability" in this repository) with:
- A clear description of the vulnerability and affected endpoint/component
- Steps to reproduce or proof-of-concept request/payload
- Any suggested remediation if known

We will acknowledge reports and work on a fix as quickly as possible.
