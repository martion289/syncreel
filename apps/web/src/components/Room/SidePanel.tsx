import { useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ClientEvent,
  MediaDetails,
  MoviePoll,
  Participant,
  ParticipantRole,
  QueueItem,
  StreamMode
} from '@syncreel/shared';
import {
  Bell,
  Cast,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Flame,
  Leaf,
  ListVideo,
  Lock,
  MessageSquare,
  MessageSquareOff,
  Play,
  Plus,
  Send,
  Share2,
  Trash2,
  UserCheck,
  UserX,
  Users
} from 'lucide-react';
import { api, isGuestPreviewTab } from '../../lib/api.js';
import { formatMediaSubtitle, getRoomArtworkUrl } from '../../lib/format.js';
import { PollPanel } from './PollPanel.js';

interface SidePanelProps {
  roomCode: string;
  roomName: string;
  hasPin: boolean;
  hostOnlyControl: boolean;
  streamMode: StreamMode;
  hasWebhook: boolean;
  selfParticipantId: string | null;
  selfRole: ParticipantRole;
  currentMedia: MediaDetails | null;
  queue: QueueItem[];
  participants: Participant[];
  chatHistory: ChatMessage[];
  poll: MoviePoll | null;
  onOpenLibrary?: () => void;
  onOpenSwipeMatch?: () => void;
  onOpenInvite?: () => void;
  sendEvent: (event: ClientEvent) => void;
}

const QUICK_REACTIONS = ['😂', '🔥', '😱', '❤️', '👏', '🍿'];

export function SidePanel(props: SidePanelProps) {
  const {
    roomCode,
    hostOnlyControl,
    streamMode,
    hasWebhook,
    selfParticipantId,
    selfRole,
    currentMedia,
    queue,
    participants,
    chatHistory,
    poll,
    onOpenLibrary,
    onOpenSwipeMatch,
    onOpenInvite,
    sendEvent
  } = props;

  const [tab, setTab] = useState<'chat' | 'queue' | 'people'>('chat');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkingAccount, setLinkingAccount] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const selfEntry = participants.find((p) => p.id === selfParticipantId);
  const selfMuted = Boolean(selfEntry?.isMuted);
  const selfHistoryLinked = Boolean(selfEntry?.plexScrobbleLinked);
  const isPreview = isGuestPreviewTab();

  useEffect(() => {
    if (tab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory.length, tab]);

  const inviteUrl = `${window.location.origin}/room/${roomCode}`;

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || selfMuted) return;
    sendEvent({ type: 'chat:send', text });
    setDraft('');
  };

  const handleGuestLinkAccount = async () => {
    setLinkingAccount(true);
    try {
      const pin = await api.createRoomPlexLinkPin(roomCode);
      window.open(pin.authUrl, 'syncreel-link', 'width=640,height=740,noopener');
      const timer = window.setInterval(async () => {
        try {
          const check = await api.pollRoomPlexLinkPin(roomCode, pin.id);
          if (check.linked) {
            clearInterval(timer);
            setLinkingAccount(false);
          }
        } catch {
          clearInterval(timer);
          setLinkingAccount(false);
        }
      }, 2000);
      window.setTimeout(() => {
        clearInterval(timer);
        setLinkingAccount(false);
      }, 120_000);
    } catch {
      setLinkingAccount(false);
    }
  };

  return (
    <aside className="w-full lg:w-[345px] h-[380px] lg:h-full bg-[#101216] border-t lg:border-t-0 lg:border-l border-white/8 flex flex-col shrink-0">
      {/* Tabs */}
      <div className="grid grid-cols-3 border-b border-white/8 p-1.5 gap-1">
        {[
          { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
          { id: 'queue' as const, label: `Up Next (${queue.length})`, icon: ListVideo },
          { id: 'people' as const, label: `Room (${participants.length})`, icon: Users }
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                active
                  ? 'bg-[#181B22] text-[#F5F7FA]'
                  : 'text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#181B22]/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Chat Tab */}
      {tab === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {poll && (
              <PollPanel
                poll={poll}
                selfParticipantId={selfParticipantId}
                selfRole={selfRole}
                totalViewers={participants.length}
                sendEvent={sendEvent}
              />
            )}

            {chatHistory.length === 0 ? (
              <p className="text-xs text-[#5C6475] text-center mt-8">
                Say hello or drop a quick reaction below.
              </p>
            ) : (
              chatHistory.map((m) => (
                <div key={m.id} className="text-xs leading-relaxed">
                  <span
                    className={`font-semibold mr-1.5 ${
                      m.role === 'host' ? 'text-[#F5F7FA]' : 'text-[#22C55E]'
                    }`}
                  >
                    {m.participantName}
                  </span>
                  <span className="text-[#C6CCD8] break-words">{m.text}</span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="px-3 py-2 border-t border-white/8 flex items-center justify-between gap-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => sendEvent({ type: 'chat:react', emoji })}
                aria-label={`React ${emoji}`}
                className="flex-1 py-1 rounded-md text-base hover:bg-[#181B22] active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {emoji}
              </button>
            ))}
          </div>

          <form onSubmit={handleSendChat} className="p-3 pt-0 flex items-center gap-2">
            <input
              type="text"
              value={draft}
              disabled={selfMuted}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder={selfMuted ? 'Muted by host…' : 'Send a message…'}
              className="flex-1 px-3 py-2 rounded-lg bg-[#07080A] border border-white/10 text-xs text-[#F5F7FA] placeholder-[#5C6475] disabled:opacity-50 focus:outline-none focus:border-white/30"
            />
            <button
              type="submit"
              disabled={selfMuted}
              aria-label="Send message"
              className="p-2 rounded-lg bg-[#F5F7FA] text-[#07080A] hover:bg-white disabled:opacity-40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </>
      )}

      {/* Up Next Queue Tab */}
      {tab === 'queue' && (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {selfRole === 'host' && (
            <div className="grid grid-cols-2 gap-2">
              {onOpenLibrary && (
                <button
                  onClick={onOpenLibrary}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Media</span>
                </button>
              )}
              {onOpenSwipeMatch && (
                <button
                  onClick={onOpenSwipeMatch}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>Swipe Match</span>
                </button>
              )}
            </div>
          )}

          {queue.length === 0 && !currentMedia?.nextEpisode && (
            <p className="text-xs text-[#5C6475] text-center mt-8">Up Next queue is empty.</p>
          )}

          {queue.map((q) => {
            const thumb = getRoomArtworkUrl(roomCode, q.media.thumb, 120, 180);
            return (
              <div
                key={q.id}
                className="flex items-center gap-2.5 p-2 rounded-lg bg-[#07080A] border border-white/10"
              >
                {thumb && (
                  <img
                    src={thumb}
                    alt={q.media.title}
                    className="w-10 h-14 object-cover rounded shrink-0 bg-[#181B22]"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#F5F7FA] truncate">{q.media.title}</p>
                  <p className="text-[11px] text-[#98A0B0] truncate">
                    {formatMediaSubtitle(q.media)}
                  </p>
                </div>
                {selfRole === 'host' && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        sendEvent({
                          type: 'room:setMedia',
                          ratingKey: q.media.ratingKey,
                          startPositionMs: 0
                        })
                      }
                      aria-label={`Play ${q.media.title}`}
                      className="p-1.5 rounded text-[#F5F7FA] hover:bg-[#181B22]"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                    <button
                      onClick={() => sendEvent({ type: 'room:queueRemove', queueItemId: q.id })}
                      aria-label={`Remove ${q.media.title}`}
                      className="p-1.5 rounded text-[#98A0B0] hover:text-[#F43F5E] hover:bg-[#181B22]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {queue.length === 0 && currentMedia?.nextEpisode && (
            <div className="p-2.5 rounded-lg bg-[#07080A] border border-white/10">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[#98A0B0] mb-1.5">
                Auto Next Episode
              </p>
              <p className="text-xs font-medium text-[#F5F7FA] truncate">
                {currentMedia.nextEpisode.title}
              </p>
              <p className="text-[11px] text-[#98A0B0] mb-2">
                {formatMediaSubtitle(currentMedia.nextEpisode)}
              </p>
              {(!hostOnlyControl || selfRole === 'host') && (
                <button
                  onClick={() => sendEvent({ type: 'room:queueNext' })}
                  className="w-full py-1.5 rounded-md bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
                >
                  Play Next Episode
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Room & People Tab */}
      {tab === 'people' && (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
          {/* Invite Box */}
          <div className="p-3 rounded-xl bg-[#07080A] border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
                Invite Friends
              </span>
              <span className="font-mono text-xs font-semibold text-[#F5F7FA]">{roomCode}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {onOpenInvite ? (
                <button
                  type="button"
                  onClick={onOpenInvite}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold hover:bg-white transition"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share &amp; Invite Everyone</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void copyInvite()}
                aria-label="Quick copy invite link"
                title="Quick copy invite link"
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
                  onOpenInvite
                    ? 'px-2.5 bg-[#181B22] border border-white/10 text-[#F5F7FA] hover:border-white/30'
                    : 'w-full bg-[#F5F7FA] text-[#07080A] hover:bg-white'
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#22C55E]" /> : <Copy className="w-3.5 h-3.5" />}
                {!onOpenInvite && <span>{copied ? 'Invite Link Copied' : 'Copy Invite Link'}</span>}
              </button>
            </div>
          </div>

          {/* Host Group Actions */}
          {selfRole === 'host' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => sendEvent({ type: 'ready:start' })}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Ready Check</span>
                </button>
                {onOpenSwipeMatch && (
                  <button
                    onClick={onOpenSwipeMatch}
                    className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>Swipe Match</span>
                  </button>
                )}
              </div>

              {hasWebhook && (
                <button
                  onClick={() => sendEvent({ type: 'room:notifyWebhook' })}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>Send Discord / Webhook Invite</span>
                </button>
              )}

              {!isPreview && (
                <button
                  onClick={() =>
                    window.open(`/room/${encodeURIComponent(roomCode)}?asGuest=1`, '_blank')
                  }
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#07080A] border border-white/10 text-xs font-medium text-[#98A0B0] hover:text-[#F5F7FA] hover:border-white/30"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Guest Preview Tab (Solo Test)</span>
                </button>
              )}

              <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#07080A] border border-white/10 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-[#F5F7FA]" />
                  <div>
                    <p className="text-xs font-medium text-[#F5F7FA]">Host-Only Control</p>
                    <p className="text-[10px] text-[#98A0B0]">Lock guest pause/seek</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={hostOnlyControl}
                  onChange={(e) =>
                    sendEvent({ type: 'room:updateSettings', hostOnlyControl: e.target.checked })
                  }
                  className="w-4 h-4 accent-[#F5F7FA] cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#07080A] border border-white/10 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Leaf className="w-3.5 h-3.5 text-[#22C55E]" />
                  <div>
                    <p className="text-xs font-medium text-[#F5F7FA]">Eco Shared Stream</p>
                    <p className="text-[10px] text-[#98A0B0]">1 shared transcode for room</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={streamMode === 'eco-shared'}
                  onChange={(e) =>
                    sendEvent({
                      type: 'room:updateSettings',
                      streamMode: e.target.checked ? 'eco-shared' : 'per-viewer'
                    })
                  }
                  className="w-4 h-4 accent-[#22C55E] cursor-pointer"
                />
              </label>
            </div>
          )}

          {/* Optional Guest Watch History Link */}
          {selfRole === 'guest' && !selfHistoryLinked && (
            <button
              disabled={linkingAccount}
              onClick={() => void handleGuestLinkAccount()}
              className="w-full py-2 px-3 rounded-lg bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 disabled:opacity-50"
            >
              {linkingAccount ? 'Waiting for account link…' : 'Sync My Watch History (Optional)'}
            </button>
          )}

          {/* Participant List with Host Moderation */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0] mb-2">
              Viewers ({participants.length})
            </p>
            <div className="space-y-1.5">
              {participants.map((p) => {
                const isSelf = p.id === selfParticipantId;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#07080A] border border-white/10"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          p.isBuffering ? 'bg-[#F5F7FA] animate-pulse' : 'bg-[#22C55E]'
                        }`}
                      />
                      <span className="text-xs font-medium text-[#F5F7FA] truncate">
                        {p.name}
                        {isSelf ? ' (you)' : ''}
                      </span>
                      {p.role === 'host' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-[#F5F7FA] font-semibold">
                          Host
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {p.isCasting && <Cast className="w-3.5 h-3.5 text-[#F5F7FA]" />}
                      <span className="font-mono text-[10px] text-[#98A0B0] tabular-nums">
                        {p.isBuffering
                          ? 'Buffer'
                          : p.driftMs !== null
                            ? `${p.driftMs >= 0 ? '+' : ''}${p.driftMs}ms`
                            : 'Ready'}
                      </span>

                      {selfRole === 'host' && !isSelf && (
                        <div className="flex items-center gap-0.5 ml-1">
                          <button
                            onClick={() =>
                              sendEvent({
                                type: 'room:mute',
                                participantId: p.id,
                                muted: !p.isMuted
                              })
                            }
                            aria-label={p.isMuted ? `Unmute ${p.name}` : `Mute ${p.name}`}
                            title={p.isMuted ? 'Unmute chat' : 'Mute chat'}
                            className={`p-1 rounded hover:bg-[#181B22] ${
                              p.isMuted ? 'text-[#F43F5E]' : 'text-[#98A0B0]'
                            }`}
                          >
                            <MessageSquareOff className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() =>
                              sendEvent({ type: 'room:transferHost', participantId: p.id })
                            }
                            aria-label={`Make ${p.name} host`}
                            title="Transfer Host"
                            className="p-1 rounded text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#181B22]"
                          >
                            <Crown className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => sendEvent({ type: 'room:kick', participantId: p.id })}
                            aria-label={`Kick ${p.name}`}
                            title="Remove viewer"
                            className="p-1 rounded text-[#98A0B0] hover:text-[#F43F5E] hover:bg-[#181B22]"
                          >
                            <UserX className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
