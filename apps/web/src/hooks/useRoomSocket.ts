import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientEvent,
  MediaSummary,
  ParticipantRole,
  RoomSnapshot,
  ServerEvent
} from '@syncreel/shared';
import { getPreviewGuestToken, isGuestPreviewTab } from '../lib/api.js';
import { useClockSync } from './useClockSync.js';

export interface FloatingReaction {
  id: string;
  emoji: string;
  participantName: string;
  xPercent: number;
}

export interface RoomNotice {
  id: string;
  level: 'info' | 'warning';
  message: string;
}

export function useRoomSocket(roomCode: string, enabled: boolean) {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [selfParticipantId, setSelfParticipantId] = useState<string | null>(null);
  const [selfRole, setSelfRole] = useState<ParticipantRole>('guest');
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [notices, setNotices] = useState<RoomNotice[]>([]);
  const [swipeMatchBanner, setSwipeMatchBanner] = useState<MediaSummary | null>(null);
  const [kickedReason, setKickedReason] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const { clockOffsetMs, recordPong, resetClockSync } = useClockSync();

  const pushNotice = useCallback((level: 'info' | 'warning', message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setNotices((prev) => [...prev.slice(-3), { id, level, message }]);
    setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
    }, 4500);
  }, []);

  const sendEvent = useCallback((event: ClientEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !roomCode) return;

    let cancelled = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({ room: roomCode });
      if (isGuestPreviewTab()) {
        params.set('asGuest', '1');
        const gt = getPreviewGuestToken(roomCode);
        if (gt) params.set('guestToken', gt);
      }

      const url = `${proto}//${window.location.host}/ws?${params.toString()}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        reconnectAttempt = 0;
        setConnected(true);
        setSocketError(null);
        resetClockSync();

        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'clock:ping', clientSendMs: Date.now() }));
            }
          }, i * 250);
        }

        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'clock:ping', clientSendMs: Date.now() }));
          }
        }, 15_000);
      };

      ws.onmessage = (msg) => {
        let evt: ServerEvent;
        try {
          evt = JSON.parse(msg.data as string) as ServerEvent;
        } catch {
          return;
        }

        switch (evt.type) {
          case 'clock:pong':
            recordPong(evt.clientSendMs, evt.serverTimeMs);
            break;
          case 'room:snapshot':
            setSnapshot(evt.snapshot);
            setSelfParticipantId(evt.selfParticipantId);
            setSelfRole(evt.selfRole);
            break;
          case 'playback:sync':
            setSnapshot((prev) => (prev ? { ...prev, playback: evt.playback } : prev));
            break;
          case 'room:participants':
            setSnapshot((prev) => (prev ? { ...prev, participants: evt.participants } : prev));
            break;
          case 'room:mediaChanged':
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    currentMedia: evt.media,
                    playback: evt.playback,
                    queue: evt.queue
                  }
                : prev
            );
            break;
          case 'room:queueUpdated':
            setSnapshot((prev) => (prev ? { ...prev, queue: evt.queue } : prev));
            break;
          case 'room:settingsUpdated':
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    hostOnlyControl: evt.hostOnlyControl,
                    name: evt.name,
                    streamMode: evt.streamMode,
                    ecoQuality: evt.ecoQuality
                  }
                : prev
            );
            break;
          case 'poll:updated':
            setSnapshot((prev) => (prev ? { ...prev, poll: evt.poll } : prev));
            break;
          case 'ready:updated':
            setSnapshot((prev) => (prev ? { ...prev, readyCheck: evt.readyCheck } : prev));
            break;
          case 'swipe:updated':
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    swipeMatch: evt.swipeMatch,
                    selfSwipeOrder: evt.selfSwipeOrder ?? prev.selfSwipeOrder,
                    selfSwipedKeys: evt.selfSwipedKeys ?? prev.selfSwipedKeys
                  }
                : prev
            );
            break;
          case 'swipe:match':
            setSwipeMatchBanner(evt.media);
            pushNotice('info', `Match! "${evt.media.title}" added to Shortlist`);
            window.setTimeout(() => {
              setSwipeMatchBanner((cur) => (cur?.ratingKey === evt.media.ratingKey ? null : cur));
            }, 4000);
            break;
          case 'room:kicked':
            setKickedReason(evt.reason);
            break;
          case 'room:notice':
            pushNotice(evt.level, evt.message);
            break;
          case 'chat:message':
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    chatHistory: [...prev.chatHistory.slice(-99), evt.message]
                  }
                : prev
            );
            break;
          case 'chat:reaction': {
            const xPercent = 12 + Math.floor(Math.random() * 76);
            setReactions((prev) => [
              ...prev.slice(-14),
              {
                id: evt.id,
                emoji: evt.emoji,
                participantName: evt.participantName,
                xPercent
              }
            ]);
            setTimeout(() => {
              setReactions((prev) => prev.filter((r) => r.id !== evt.id));
            }, 2600);
            break;
          }
          case 'error':
            pushNotice('warning', evt.message);
            break;
        }
      };

      ws.onclose = (closeEvt) => {
        if (pingTimer !== null) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        setConnected(false);
        wsRef.current = null;

        if (cancelled) return;
        if (closeEvt.code === 4008 || closeEvt.code === 4009) {
          setKickedReason(closeEvt.reason || 'You were removed from this room.');
          return;
        }
        if (closeEvt.code === 4003 || closeEvt.code === 4004) {
          setSocketError(closeEvt.reason || 'Room access denied or expired.');
          return;
        }

        const delayMs = Math.min(8000, 750 * Math.pow(1.6, reconnectAttempt));
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (pingTimer !== null) clearInterval(pingTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, roomCode, pushNotice, recordPong, resetClockSync]);

  return {
    connected,
    snapshot,
    selfParticipantId,
    selfRole,
    clockOffsetMs,
    reactions,
    notices,
    swipeMatchBanner,
    kickedReason,
    socketError,
    sendEvent
  };
}
