import { useCallback, useEffect, useState } from 'react';

export function useAirPlay(videoEl: HTMLVideoElement | null) {
  const [canAirPlay, setCanAirPlay] = useState(false);
  const [isAirPlayActive, setIsAirPlayActive] = useState(false);

  useEffect(() => {
    if (!videoEl || typeof videoEl.webkitShowPlaybackTargetPicker !== 'function') {
      setCanAirPlay(false);
      setIsAirPlayActive(false);
      return;
    }

    // Safari exposes availability event; default true on Safari until told not-available
    setCanAirPlay(true);
    setIsAirPlayActive(Boolean(videoEl.webkitCurrentPlaybackTargetIsWireless));

    const onAvailability = (evt: Event) => {
      const e = evt as WebKitPlaybackTargetAvailabilityEvent;
      setCanAirPlay(e.availability === 'available');
    };

    const onWirelessChanged = () => {
      setIsAirPlayActive(Boolean(videoEl.webkitCurrentPlaybackTargetIsWireless));
    };

    videoEl.addEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
    videoEl.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChanged);

    return () => {
      videoEl.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
      videoEl.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChanged);
    };
  }, [videoEl]);

  const showAirPlayPicker = useCallback(() => {
    videoEl?.webkitShowPlaybackTargetPicker?.();
  }, [videoEl]);

  return { canAirPlay, isAirPlayActive, showAirPlayPicker };
}
