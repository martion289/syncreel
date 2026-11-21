import type { MediaSummary } from '@syncreel/shared';

export function formatTimeMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const mm = String(mins).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatMediaSubtitle(item: MediaSummary): string {
  if (item.type === 'episode') {
    const show = item.grandparentTitle ? `${item.grandparentTitle} • ` : '';
    const s = item.parentIndex != null ? `S${String(item.parentIndex).padStart(2, '0')}` : '';
    const e = item.index != null ? `E${String(item.index).padStart(2, '0')}` : '';
    return `${show}${s}${e}`.trim();
  }
  if (item.type === 'show') {
    const parts: string[] = ['TV Series'];
    if (item.year) parts.push(String(item.year));
    if (item.childCount) parts.push(`${item.childCount} Season${item.childCount === 1 ? '' : 's'}`);
    return parts.join(' • ');
  }
  return item.year ? String(item.year) : 'Movie';
}

export function getRoomArtworkUrl(roomCode: string, plexPath: string | undefined, w = 400, h = 600): string | undefined {
  if (!plexPath) return undefined;
  return `/api/rooms/${encodeURIComponent(roomCode)}/artwork?path=${encodeURIComponent(plexPath)}&w=${w}&h=${h}`;
}

export function getHostArtworkUrl(plexPath: string | undefined, w = 400, h = 600): string | undefined {
  if (!plexPath) return undefined;
  return `/api/plex/artwork?path=${encodeURIComponent(plexPath)}&w=${w}&h=${h}`;
}
