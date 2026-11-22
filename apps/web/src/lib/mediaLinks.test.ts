import { describe, expect, it } from 'vitest';
import { getPlexNativeAppUrl, getPlexWebUrl } from './mediaLinks.js';

describe('mediaLinks', () => {
  it('builds current mobile deep links for movies, shows, episodes, and default type', () => {
    expect(getPlexNativeAppUrl('srv-123', '987', 'movie')).toBe(
      'plex://libraries/srv-123/unmatched/%2Flibrary%2Fmetadata%2F987'
    );
    expect(getPlexNativeAppUrl('srv-123', '987')).toBe(
      'plex://libraries/srv-123/unmatched/%2Flibrary%2Fmetadata%2F987'
    );
    expect(getPlexNativeAppUrl('srv-123', '456', 'show')).toBe(
      'plex://libraries/srv-123/unmatched/tv/%2Flibrary%2Fmetadata%2F456'
    );
    expect(getPlexNativeAppUrl('srv-123', '789', 'episode')).toBe(
      'plex://libraries/srv-123/unmatched/tv/%2Flibrary%2Fmetadata%2F789'
    );
  });

  it('encodes special characters in serverMachineId and ratingKey', () => {
    expect(getPlexNativeAppUrl('srv/a b', 'id?1', 'movie')).toBe(
      'plex://libraries/srv%2Fa%20b/unmatched/%2Flibrary%2Fmetadata%2Fid%3F1'
    );
    expect(getPlexWebUrl('srv/a b', 'id?1')).toBe(
      'https://app.plex.tv/desktop/#!/server/srv%2Fa%20b/details?key=%2Flibrary%2Fmetadata%2Fid%3F1'
    );
  });
});
