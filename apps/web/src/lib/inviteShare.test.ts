import { describe, expect, it } from 'vitest';
import {
  buildInviteMessage,
  buildQrSvgPath,
  buildShareChannelUrls,
  generateFunRoomSlug
} from './inviteShare.js';

describe('generateFunRoomSlug', () => {
  it('generates valid lowercase hyphenated slugs matching server constraints', () => {
    const slugRegex = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
    expect(generateFunRoomSlug(() => 0)).toMatch(slugRegex);
    expect(generateFunRoomSlug(() => 0.9999)).toMatch(slugRegex);
    expect(generateFunRoomSlug(() => 1.5)).toMatch(slugRegex);
    for (let i = 0; i < 20; i++) {
      expect(generateFunRoomSlug()).toMatch(slugRegex);
    }
  });
});

describe('buildInviteMessage', () => {
  it('formats room name, optional media title, URL, code, and conditional PIN', () => {
    const base = buildInviteMessage({
      roomName: 'Friday Film Club',
      roomCode: 'velvet-cinema',
      inviteUrl: 'https://watch.example.com/room/velvet-cinema',
      mediaTitle: 'Interstellar',
      pin: '4321',
      includePin: false
    });

    expect(base).toContain('Join "Friday Film Club" on SyncReel!');
    expect(base).toContain('Now playing: Interstellar');
    expect(base).toContain('https://watch.example.com/room/velvet-cinema');
    expect(base).toContain('Room code: velvet-cinema');
    expect(base).not.toContain('4321');

    const withPin = buildInviteMessage({
      roomName: 'Friday Film Club',
      roomCode: 'velvet-cinema',
      inviteUrl: 'https://watch.example.com/room/velvet-cinema',
      pin: '4321',
      includePin: true
    });
    expect(withPin).not.toContain('Now playing:');
    expect(withPin).toContain('PIN: 4321');
  });
});

describe('buildShareChannelUrls', () => {
  it('creates properly encoded share URLs for WhatsApp, SMS, Telegram, and Email', () => {
    const inviteUrl = 'https://watch.example.com/room/K7M4QP';
    const message = buildInviteMessage({
      roomName: 'Movie Night',
      roomCode: 'K7M4QP',
      inviteUrl
    });
    const urls = buildShareChannelUrls({
      roomName: 'Movie Night',
      inviteUrl,
      message
    });

    expect(urls.whatsapp).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(urls.whatsapp.split('text=')[1])).toBe(message);
    expect(urls.sms).toMatch(/^sms:\?&body=/);
    expect(urls.telegram).toContain(encodeURIComponent(inviteUrl));
    expect(urls.email).toMatch(/^mailto:\?subject=.*&body=/);
  });
});

describe('buildQrSvgPath', () => {
  it('encodes a room URL into a valid SVG path and module grid size', () => {
    const qr = buildQrSvgPath('https://watch.example.com/room/K7M4QP');
    expect(qr.size).toBeGreaterThanOrEqual(21);
    expect(qr.path.startsWith('M')).toBe(true);
    expect(qr.path).toContain('h1v1h-1z');
  });
});
