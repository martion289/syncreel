import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Film,
  Flame,
  Loader2,
  MessageSquare,
  WifiOff
} from 'lucide-react';
import { isGuestPreviewTab } from '../lib/api.js';
import { computeFloatingChatLifetimeMs, isEmojiOnlyMessage } from '../lib/floatingOverlay.js';
import { useRoomSocket, type FloatingReaction } from '../hooks/useRoomSocket.js';
import { VideoStage } from '../components/Player/VideoStage.js';
import { SidePanel } from '../components/Room/SidePanel.js';
import {
  FloatingReactions,
  type FloatingChatItem
} from '../components/Room/FloatingReactions.js';
import { LibraryBrowser } from '../components/Library/LibraryBrowser.js';
import { SwipeMatchModal } from '../components/Room/SwipeMatchModal.js';

const FLOATING_OVERLAY_STORAGE_KEY = 'syncreel_floating_overlay_v1';

interface RoomPageProps {
  roomCode: string;
  onBackHome: () => void;
  onRequireJoin: () => void;
}

export function RoomPage({ roomCode, onBackHome, onRequireJoin }: RoomPageProps) {
  const isTvMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('tv') === '1';

  const [sidebarOpen, setSidebarOpen] = useState(!isTvMode);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [swipeOpen, setSwipeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [floatingOverlayEnabled, setFloatingOverlayEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(FLOATING_OVERLAY_STORAGE_KEY);
      if (saved === 'false') return false;
    } catch {
      // Ignore storage failures
    }
    return true;
  });
  const [floatingChat, setFloatingChat] = useState<FloatingChatItem[]>([]);
  const [chatEmojiBursts, setChatEmojiBursts] = useState<FloatingReaction[]>([]);

  const lastSwipeIdRef = useRef<string | null>(null);
  const initializedChatRef = useRef(false);
  const seenChatIdsRef = useRef<Set<string>>(new Set());
  const chatTimersRef = useRef<Map<string, number>>(new Map());

  const {
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
  } = useRoomSocket(roomCode, true);

  useEffect(() => {
    if (socketError) {
      onRequireJoin();
    }
  }, [socketError, onRequireJoin]);

  // Auto-open Swipe Match modal for everyone when the host deals a new deck
  useEffect(() => {
    const smId = snapshot?.swipeMatch?.id ?? null;
    if (smId && smId !== lastSwipeIdRef.current) {
      lastSwipeIdRef.current = smId;
      setSwipeOpen(true);
    } else if (!smId) {
      lastSwipeIdRef.current = null;
    }
  }, [snapshot?.swipeMatch?.id]);

  const clearChatOverlayTimers = useCallback(() => {
    for (const timer of chatTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    chatTimersRef.current.clear();
  }, []);

  useEffect(() => clearChatOverlayTimers, [clearChatOverlayTimers]);

  useEffect(() => {
    initializedChatRef.current = false;
    seenChatIdsRef.current.clear();
    clearChatOverlayTimers();
    setFloatingChat([]);
    setChatEmojiBursts([]);
  }, [roomCode, clearChatOverlayTimers]);

  const toggleFloatingOverlay = useCallback(() => {
    setFloatingOverlayEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FLOATING_OVERLAY_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures
      }
      if (!next) {
        clearChatOverlayTimers();
        setFloatingChat([]);
        setChatEmojiBursts([]);
      }
      return next;
    });
  }, [clearChatOverlayTimers]);

  // Float new chat messages and emoji-only messages inside the video stage (including fullscreen)
  useEffect(() => {
    if (!snapshot) return;
    const history = snapshot.chatHistory;
    if (!initializedChatRef.current) {
      for (const msg of history) {
        seenChatIdsRef.current.add(msg.id);
      }
      initializedChatRef.current = true;
      return;
    }

    const newMessages = history.filter((m) => !seenChatIdsRef.current.has(m.id));
    if (newMessages.length === 0) return;

    for (const msg of newMessages) {
      seenChatIdsRef.current.add(msg.id);
      if (!floatingOverlayEnabled || (!isFullscreen && sidebarOpen)) {
        continue;
      }

      const lifetimeMs = computeFloatingChatLifetimeMs(msg.text);
      if (isEmojiOnlyMessage(msg.text)) {
        const burst: FloatingReaction = {
          id: msg.id,
          emoji: msg.text.trim(),
          participantName: msg.participantName,
          xPercent: 14 + Math.floor(Math.random() * 70)
        };
        setChatEmojiBursts((prev) => [...prev.slice(-14), burst]);
        const timer = window.setTimeout(() => {
          chatTimersRef.current.delete(msg.id);
          setChatEmojiBursts((prev) => prev.filter((r) => r.id !== msg.id));
        }, lifetimeMs);
        chatTimersRef.current.set(msg.id, timer);
      } else {
        setFloatingChat((prev) => [...prev.slice(-3), { message: msg, durationMs: lifetimeMs }]);
        const timer = window.setTimeout(() => {
          chatTimersRef.current.delete(msg.id);
          setFloatingChat((prev) => prev.filter((item) => item.message.id !== msg.id));
        }, lifetimeMs);
        chatTimersRef.current.set(msg.id, timer);
      }
    }
  }, [snapshot, snapshot?.chatHistory, floatingOverlayEnabled, isFullscreen, sidebarOpen]);

  const copyInvite = async () => {
    await navigator.clipboard
      .writeText(`${window.location.origin}/room/${snapshot?.code ?? roomCode}`)
      .catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (kickedReason) {
    return (
      <div className="min-h-screen bg-[#0E0E10] flex items-center justify-center px-5">
        <div className="w-full max-w-md rounded-2xl bg-[#16161A] border border-[#D94848]/40 p-6 text-center space-y-4">
          <h1 className="text-lg font-bold text-[#F4F2EE]">Removed from Room</h1>
          <p className="text-sm text-[#9C9AA6]">{kickedReason}</p>
          <button
            onClick={onBackHome}
            className="px-4 py-2.5 rounded-xl bg-[#202026] border border-[#2B2B33] text-sm font-medium text-[#F4F2EE] hover:border-[#E5A00D]"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-[#0E0E10] flex flex-col items-center justify-center gap-3 text-[#9C9AA6] text-sm">
        <Loader2 className="w-6 h-6 animate-spin text-[#E5A00D]" />
        <span>Connecting to screening room {roomCode}…</span>
      </div>
    );
  }

  const isPreview = isGuestPreviewTab();
  const selfEntry = snapshot.participants.find((p) => p.id === selfParticipantId);
  const showOverlayChat = floatingOverlayEnabled && (isFullscreen || !sidebarOpen);

  return (
    <div className="h-screen bg-[#0E0E10] text-[#F4F2EE] flex flex-col overflow-hidden">
      {/* Slim Room Top Bar */}
      <header className="h-12 px-3 sm:px-4 bg-[#16161A] border-b border-[#2B2B33] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBackHome}
            aria-label="Leave room"
            className="p-1.5 rounded-lg text-[#9C9AA6] hover:text-[#F4F2EE] hover:bg-[#202026] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold truncate">{snapshot.name}</span>
          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#0E0E10] border border-[#2B2B33] text-[#E5A00D] shrink-0">
            {snapshot.code}
          </span>
          {isPreview && (
            <span className="hidden sm:inline text-[10px] px-2 py-0.5 rounded bg-[#E5A00D]/15 text-[#E5A00D] font-medium">
              Guest Preview
            </span>
          )}
          {!connected && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#D94848]">
              <WifiOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reconnecting…</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void copyInvite()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#202026] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D]/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[#34C77B]" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#E5A00D]" />
            )}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Invite'}</span>
          </button>

          {(selfRole === 'host' || snapshot.swipeMatch) && (
            <button
              onClick={() => setSwipeOpen(true)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D] ${
                snapshot.swipeMatch
                  ? 'bg-[#E5A00D]/15 border-[#E5A00D] text-[#E5A00D]'
                  : 'bg-[#202026] border-[#2B2B33] text-[#F4F2EE] hover:border-[#E5A00D]'
              }`}
            >
              <Flame className="w-3.5 h-3.5 text-[#E5A00D]" />
              <span className="hidden sm:inline">
                {snapshot.swipeMatch
                  ? `Swipe (${snapshot.swipeMatch.matchedRatingKeys.length})`
                  : 'Swipe Match'}
              </span>
            </button>
          )}

          {selfRole === 'host' && (
            <button
              onClick={() => setLibraryOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5A00D] text-[#111113] text-xs font-semibold hover:bg-[#f0ad1c] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
            >
              <Film className="w-3.5 h-3.5" />
              <span>Library</span>
            </button>
          )}

          <button
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Hide chat and room panel' : 'Show chat and room panel'}
            className={`p-1.5 rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D] ${
              sidebarOpen
                ? 'bg-[#202026] border-[#2B2B33] text-[#E5A00D]'
                : 'bg-[#0E0E10] border-[#2B2B33] text-[#9C9AA6] hover:text-[#F4F2EE]'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Theater Stage + Collapsible SidePanel */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="relative flex-1 flex min-w-0 min-h-0">
          <VideoStage
            roomCode={snapshot.code}
            media={snapshot.currentMedia}
            playback={snapshot.playback}
            participants={snapshot.participants}
            selfParticipantId={selfParticipantId}
            selfRole={selfRole}
            hostOnlyControl={snapshot.hostOnlyControl}
            streamMode={snapshot.streamMode}
            ecoQuality={snapshot.ecoQuality}
            readyCheck={snapshot.readyCheck}
            clockOffsetMs={clockOffsetMs}
            hasNextInQueue={snapshot.queue.length > 0}
            isSidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
            onOpenLibrary={selfRole === 'host' ? () => setLibraryOpen(true) : undefined}
            onOpenSwipeMatch={selfRole === 'host' ? () => setSwipeOpen(true) : undefined}
            onFullscreenChange={setIsFullscreen}
            isSelfMuted={Boolean(selfEntry?.isMuted)}
            floatingOverlayEnabled={floatingOverlayEnabled}
            onToggleFloatingOverlay={toggleFloatingOverlay}
            overlay={
              <FloatingReactions
                reactions={floatingOverlayEnabled ? [...reactions, ...chatEmojiBursts] : []}
                notices={notices}
                ephemeralChat={floatingOverlayEnabled ? floatingChat : []}
                showChatToasts={showOverlayChat}
                isFullscreen={isFullscreen}
                swipeMatchBanner={swipeMatchBanner}
                onOpenSwipeShortlist={() => setSwipeOpen(true)}
              />
            }
            sendEvent={sendEvent}
          />
        </div>

        {sidebarOpen && (
          <SidePanel
            roomCode={snapshot.code}
            roomName={snapshot.name}
            hasPin={snapshot.hasPin}
            hostOnlyControl={snapshot.hostOnlyControl}
            streamMode={snapshot.streamMode}
            hasWebhook={snapshot.hasWebhook}
            selfParticipantId={selfParticipantId}
            selfRole={selfRole}
            currentMedia={snapshot.currentMedia}
            queue={snapshot.queue}
            participants={snapshot.participants}
            chatHistory={snapshot.chatHistory}
            poll={snapshot.poll}
            onOpenLibrary={selfRole === 'host' ? () => setLibraryOpen(true) : undefined}
            onOpenSwipeMatch={selfRole === 'host' ? () => setSwipeOpen(true) : undefined}
            sendEvent={sendEvent}
          />
        )}
      </div>

      {selfRole === 'host' && (
        <LibraryBrowser
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          onPlayNow={(ratingKey) => sendEvent({ type: 'room:setMedia', ratingKey })}
          onAddToQueue={(ratingKey) => sendEvent({ type: 'room:queueAdd', ratingKey })}
          onStartPoll={(ratingKeys) => sendEvent({ type: 'poll:start', ratingKeys })}
        />
      )}

      <SwipeMatchModal
        open={swipeOpen}
        onClose={() => setSwipeOpen(false)}
        roomCode={snapshot.code}
        selfRole={selfRole}
        participants={snapshot.participants}
        swipeMatch={snapshot.swipeMatch}
        selfSwipeOrder={snapshot.selfSwipeOrder}
        selfSwipedKeys={snapshot.selfSwipedKeys}
        matchBanner={swipeMatchBanner}
        sendEvent={sendEvent}
      />
    </div>
  );
}
