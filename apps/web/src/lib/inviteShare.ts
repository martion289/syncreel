import { encode } from 'uqr';

const ADJECTIVES = [
  'popcorn',
  'velvet',
  'midnight',
  'golden',
  'cozy',
  'neon',
  'silver',
  'starlight',
  'friday',
  'couch',
  'twilight',
  'cosmic'
];

const NOUNS = [
  'reel',
  'cinema',
  'lounge',
  'night',
  'screen',
  'ticket',
  'club',
  'party',
  'matinee',
  'show',
  'theater',
  'house'
];

const PIN_SESSION_PREFIX = 'syncreel_room_pin_';

export function generateFunRoomSlug(randFn: () => number = Math.random): string {
  const clampUnit = (v: number) => Math.min(0.999999999, Math.max(0, v));
  const adj = ADJECTIVES[Math.floor(clampUnit(randFn()) * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(clampUnit(randFn()) * NOUNS.length)];
  return `${adj}-${noun}`;
}

export interface BuildInviteMessageInput {
  roomName: string;
  roomCode: string;
  inviteUrl: string;
  mediaTitle?: string | null;
  pin?: string | null;
  includePin?: boolean;
}

export function buildInviteMessage(params: BuildInviteMessageInput): string {
  const { roomName, roomCode, inviteUrl, mediaTitle, pin, includePin = false } = params;
  const lines = [`🍿 Join "${roomName.trim() || 'Movie Night'}" on SyncReel!`];
  if (mediaTitle?.trim()) {
    lines.push(`Now playing: ${mediaTitle.trim()}`);
  }
  lines.push(
    'No account needed — tap to watch in sync:',
    inviteUrl,
    `Room code: ${roomCode}`
  );
  if (includePin && pin?.trim()) {
    lines.push(`PIN: ${pin.trim()}`);
  }
  return lines.join('\n');
}

export interface ShareChannelUrls {
  whatsapp: string;
  sms: string;
  telegram: string;
  email: string;
}

export function buildShareChannelUrls(params: {
  roomName: string;
  inviteUrl: string;
  message: string;
}): ShareChannelUrls {
  const { roomName, inviteUrl, message } = params;
  const telegramText = message
    .split('\n')
    .filter((line) => line.trim() !== inviteUrl.trim())
    .join('\n')
    .trim();

  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}`,
    sms: `sms:?&body=${encodeURIComponent(message)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(telegramText || message)}`,
    email: `mailto:?subject=${encodeURIComponent(`Watch "${roomName}" together on SyncReel`)}&body=${encodeURIComponent(message)}`
  };
}

export function saveSessionRoomPin(roomCode: string, pin: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const cleaned = pin.trim();
  if (!cleaned) return;
  try {
    sessionStorage.setItem(`${PIN_SESSION_PREFIX}${roomCode.toLowerCase()}`, cleaned);
  } catch {
    // Ignore restricted storage contexts
  }
}

export function getSessionRoomPin(roomCode: string): string {
  if (typeof sessionStorage === 'undefined') return '';
  try {
    return sessionStorage.getItem(`${PIN_SESSION_PREFIX}${roomCode.toLowerCase()}`) ?? '';
  } catch {
    return '';
  }
}

export function buildQrSvgPath(value: string): { size: number; path: string } {
  const encoded = encode(value, { ecc: 'M', border: 2 });
  const commands: string[] = [];
  for (let y = 0; y < encoded.size; y++) {
    const row = encoded.data[y];
    for (let x = 0; x < encoded.size; x++) {
      if (row?.[x]) {
        commands.push(`M${x},${y}h1v1h-1z`);
      }
    }
  }
  return {
    size: encoded.size,
    path: commands.join('')
  };
}
