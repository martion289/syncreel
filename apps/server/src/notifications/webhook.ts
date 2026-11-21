import net from 'node:net';
import type { MediaDetails } from '@syncreel/shared';

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    return false;
  }
  return false;
}

export function validateWebhookUrl(rawUrl: string, allowHttpInTest = false): { valid: boolean; reason?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { valid: true };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Webhook URL must be a valid URL' };
  }

  if (parsed.protocol !== 'https:' && !(allowHttpInTest && parsed.protocol === 'http:')) {
    return { valid: false, reason: 'Webhook URL must start with https://' };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isPrivateIp(host)
  ) {
    return { valid: false, reason: 'Webhook URL cannot target private or loopback addresses' };
  }

  return { valid: true };
}

export async function sendRoomWebhook(params: {
  webhookUrl: string;
  publicUrl: string;
  roomCode: string;
  roomName: string;
  hostName: string;
  media: MediaDetails | null;
  isTest?: boolean;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; error?: string }> {
  const { webhookUrl, publicUrl, roomCode, roomName, hostName, media, isTest = false, fetchFn = fetch } = params;
  if (!webhookUrl) return { ok: false, error: 'No webhook configured' };

  const validation = validateWebhookUrl(webhookUrl);
  if (!validation.valid) {
    return { ok: false, error: validation.reason };
  }

  const baseUrl = publicUrl || 'https://syncreel.local';
  const joinUrl = `${baseUrl.replace(/\/+$/, '')}/room/${encodeURIComponent(roomCode)}`;
  const isDiscord = /discord(app)?\.com\/api\/webhooks\//i.test(webhookUrl);

  let title = isTest ? 'SyncReel Webhook Test' : `Movie Night: ${roomName}`;
  let description = isTest
    ? `SyncReel webhook integration is working!`
    : `${hostName} opened screening room **${roomCode}**.\n[Join Screening Room](${joinUrl})`;

  if (media && !isTest) {
    const sub =
      media.type === 'episode' && media.grandparentTitle
        ? `${media.grandparentTitle} • S${String(media.parentIndex ?? 1).padStart(2, '0')}E${String(media.index ?? 1).padStart(2, '0')}`
        : media.year
          ? String(media.year)
          : '';
    title = `Now Playing: ${media.title}${sub ? ` (${sub})` : ''}`;
    description = `**${roomName}** hosted by ${hostName}\n[Join Watch Party](${joinUrl})`;
  }

  const body = isDiscord
    ? {
        username: 'SyncReel',
        embeds: [
          {
            title,
            description,
            color: 0xe5a00d,
            url: joinUrl,
            footer: { text: `Room ${roomCode} • SyncReel for Plex` },
            timestamp: new Date().toISOString()
          }
        ]
      }
    : {
        event: isTest ? 'webhook.test' : 'room.started',
        roomCode,
        roomName,
        hostName,
        joinUrl,
        media: media
          ? {
              ratingKey: media.ratingKey,
              title: media.title,
              type: media.type,
              year: media.year
            }
          : null,
        timestamp: new Date().toISOString()
      };

  try {
    const res = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      return { ok: false, error: `Webhook responded with HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Webhook request failed' };
  }
}
