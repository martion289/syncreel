import { useCallback, useRef, useState } from 'react';

export function useClockSync() {
  const samplesRef = useRef<number[]>([]);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  const recordPong = useCallback((clientSendMs: number, serverTimeMs: number) => {
    const now = Date.now();
    const rtt = Math.max(0, now - clientSendMs);
    const offset = serverTimeMs - (clientSendMs + rtt / 2);

    const next = [...samplesRef.current, offset].slice(-7);
    samplesRef.current = next;

    const sorted = [...next].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    setClockOffsetMs(Math.round(median));
  }, []);

  const resetClockSync = useCallback(() => {
    samplesRef.current = [];
  }, []);

  return { clockOffsetMs, recordPong, resetClockSync };
}
