import type { MediaSummary } from '@syncreel/shared';

/** Build the universal Plex Web details URL for a media item. */
export function getPlexWebUrl(serverMachineId: string, ratingKey: string): string {
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(serverMachineId)}/details?key=${encodeURIComponent(
    `/library/metadata/${ratingKey}`
  )}`;
}

/**
 * Build a native mobile app deep link (`plex://libraries/.../unmatched/...`)
 * pointing directly at a movie or TV show details page in current mobile clients.
 */
export function getPlexNativeAppUrl(
  serverMachineId: string,
  ratingKey: string,
  mediaType?: MediaSummary['type']
): string {
  const encodedServer = encodeURIComponent(serverMachineId);
  const encodedKey = encodeURIComponent(`/library/metadata/${ratingKey}`);
  const isTv = mediaType === 'show' || mediaType === 'season' || mediaType === 'episode';
  if (isTv) {
    return `plex://libraries/${encodedServer}/unmatched/tv/${encodedKey}`;
  }
  return `plex://libraries/${encodedServer}/unmatched/${encodedKey}`;
}

/** Detect mobile/tablet touch clients where native media app deep-linking is preferred. */
export function isMobileClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
