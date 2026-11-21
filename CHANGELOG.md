# Changelog

All notable changes to **SyncReel** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-21

### Added
- **Multi-Channel "Invite Everyone" Modal**: Automatically opens when creating a room (or via **Invite** / **Share & Invite Everyone** / empty-stage **Invite Friends**), with scannable local SVG QR code (`uqr`), large TV/living-room room code display, native OS Share Sheet integration, one-tap WhatsApp / Messages (SMS) / Telegram / Email / Discord links, formatted message preview with optional PIN inclusion, live room presence chips, and quick **Swipe Match** / **Pick Movie** actions.
- **Fun Memorable Room Slug Generator**: Added a dice generator (`velvet-cinema`, `midnight-reel`, etc.) and live room URL preview on the Home screen.

## [1.0.0] - 2026-11-21

### Added
- **Zero-Config Boot & Setup Wizard**: Auto-generated `/data/secret.key` with AES-256-GCM atomic `state.json` persistence and a 3-step browser Setup Wizard with Plex OAuth PIN flow and parallel server connection latency probing.
- **Zero-Account Guest Invites & Vanity Rooms**: Create screening rooms with optional custom URL slugs (`/room/friday-night`) and optional PIN locks. Guests join with only a display name and can optionally link their own Plex account to scrobble personal watch history.
- **Optional Shared Plex Friend Hosting**: Toggle whether shared Plex Friends may authenticate via Plex OAuth and host rooms using their own Plex permissions.
- **Tinder-Style Swipe Match (Movies & TV Shows)**:
  - Filter decks by library (`All Libraries`, `Movies`, `TV Shows`, or specific sections), genre or Wildcard, `Unwatched only`, and deck size (`15`, `25`, `40`).
  - Full-viewport mobile-first poster card deck with pointer velocity flick detection, peeking next card stack, animated fly-off exits, frosted slide-up plot synopsis, match celebration banner, close-call partial likes, and smart TV show resolution (next unwatched / `S01E01`).
- **Quick Movie Polls & Ready Check**: Create 2–6 title polls manually or from random library picks, followed by a synchronized Ready Check and **3 · 2 · 1** playback countdown.
- **Sub-Second Authoritative Sync Engine**: NTP-style clock offset sync, 3-tier drift correction (tolerance, rate nudge, hard seek), automatic buffering pause/recovery, host moderation (mute, kick, transfer host), collaborative or Host-Only lock, and Queue Up Next + Auto Next Episode.
- **Per-Viewer HLS & Eco Shared Stream**: Switch rooms between independent per-viewer streams and single-transcode **Eco Shared Stream** mode with `PartMutex` serialization, 20s Plex keepalives, and proxy token redaction.
- **Embedded MKV Subtitles**: On-the-fly extraction and SRT/ASS-to-WebVTT conversion with per-viewer font size, background opacity, and non-drifting `±5000ms` subtitle offset controls.
- **Fullscreen Floating Messages & Quick-Chat Bar**: Floating chat bubbles (upper-right, subtitle-safe) and floating emoji bursts (reaction bar + emoji-only messages) rendered inside the fullscreen player container with an inline Quick Chat / Emoji bar and persisted `On-screen: On/Off` toggle.
- **Cross-Device Playback & PWA**: Installable mobile PWA, Safari AirPlay, Google Cast Web Sender integration, Picture-in-Picture, OS Media Session API controls, Skip Intro/Credits markers, and Smart TV remote keyboard shortcuts (`?tv=1`).
- **Discord / Webhook Notifications & Admin Dashboard**: SSRF-safe webhook invites plus an Admin modal to inspect live rooms, participants, and active Plex transcode sessions.
- **Solo Multi-Viewer Testing**: Built-in `Open Guest Preview Tab` (`?asGuest=1`) and `Sim 4s Buffer` testing workflow.
