import { useEffect, useMemo, useRef, useState } from 'react';
import type { Participant, ParticipantRole } from '@syncreel/shared';
import {
  Bell,
  Check,
  Copy,
  Film,
  Flame,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  Share2,
  Tv,
  Users,
  X
} from 'lucide-react';
import {
  buildInviteMessage,
  buildQrSvgPath,
  buildShareChannelUrls,
  getSessionRoomPin,
  saveSessionRoomPin
} from '../../lib/inviteShare.js';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  roomName: string;
  hasPin: boolean;
  hasWebhook: boolean;
  selfRole: ParticipantRole;
  participants: Participant[];
  currentMediaTitle?: string | null;
  onSendWebhook?: () => void;
  onOpenLibrary?: () => void;
  onOpenSwipeMatch?: () => void;
  doneLabel?: string;
}

type CopyKind = 'code' | 'link' | 'invite';

export function InviteModal(props: InviteModalProps) {
  const {
    open,
    onClose,
    roomCode,
    roomName,
    hasPin,
    hasWebhook,
    selfRole,
    participants,
    currentMediaTitle,
    onSendWebhook,
    onOpenLibrary,
    onOpenSwipeMatch,
    doneLabel = 'Done'
  } = props;

  const [includePin, setIncludePin] = useState(false);
  const [pinDraft, setPinDraft] = useState(() => getSessionRoomPin(roomCode));
  const [copiedKind, setCopiedKind] = useState<CopyKind | null>(null);
  const [webhookSent, setWebhookSent] = useState(false);

  const copyTimerRef = useRef<number | null>(null);
  const webhookTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPinDraft(getSessionRoomPin(roomCode));
    setIncludePin(false);
    setCopiedKind(null);
    setWebhookSent(false);
  }, [roomCode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      if (webhookTimerRef.current !== null) window.clearTimeout(webhookTimerRef.current);
    };
  }, []);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://syncreel.local';
  const hostLabel =
    typeof window !== 'undefined' ? window.location.host : 'your SyncReel URL';
  const inviteUrl = `${origin}/room/${encodeURIComponent(roomCode)}`;

  const qr = useMemo(() => buildQrSvgPath(inviteUrl), [inviteUrl]);

  const inviteMessage = useMemo(
    () =>
      buildInviteMessage({
        roomName,
        roomCode,
        inviteUrl,
        mediaTitle: currentMediaTitle,
        pin: pinDraft,
        includePin
      }),
    [roomName, roomCode, inviteUrl, currentMediaTitle, pinDraft, includePin]
  );

  const channelUrls = useMemo(
    () =>
      buildShareChannelUrls({
        roomName,
        inviteUrl,
        message: inviteMessage
      }),
    [roomName, inviteUrl, inviteMessage]
  );

  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  if (!open) return null;

  const copyText = async (kind: CopyKind, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedKind(kind);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedKind(null);
      copyTimerRef.current = null;
    }, 2000);
  };

  const handleNativeShare = async () => {
    if (!supportsNativeShare) return;
    try {
      await navigator.share({
        title: `Join "${roomName}" on SyncReel`,
        text: inviteMessage,
        url: inviteUrl
      });
    } catch {
      // User dismissed share sheet or share canceled
    }
  };

  const handleWebhookPost = () => {
    if (!onSendWebhook) return;
    onSendWebhook();
    setWebhookSent(true);
    if (webhookTimerRef.current !== null) window.clearTimeout(webhookTimerRef.current);
    webhookTimerRef.current = window.setTimeout(() => {
      setWebhookSent(false);
      webhookTimerRef.current = null;
    }, 2500);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-5"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
        className="w-full max-w-xl max-h-[92dvh] flex flex-col rounded-2xl bg-[#101216] border border-white/12 overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/8 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#181B22] border border-white/12 flex items-center justify-center text-[#F5F7FA] shrink-0">
              <Share2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="invite-modal-title" className="font-display text-sm sm:text-base font-bold text-[#F5F7FA]">
                Invite Everyone
              </h2>
              <p className="text-xs text-[#98A0B0] truncate">
                {roomName} — friends don&apos;t need an account
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Invite modal"
            className="p-1.5 rounded-lg text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#181B22] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Live "In the Room" Lobby Presence */}
          <div className="p-3 rounded-xl bg-[#07080A] border border-white/10 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
                <Users className="w-3.5 h-3.5 text-[#22C55E]" />
                In this room ({participants.length})
              </span>
              {participants.length <= 1 && (
                <span className="text-[11px] text-[#5C6475]">
                  Friends appear here live as they join
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {participants.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#101216] border border-white/10 text-xs text-[#F5F7FA]"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      p.isBuffering ? 'bg-[#F5F7FA] animate-pulse' : 'bg-[#22C55E]'
                    }`}
                  />
                  <span>{p.name}</span>
                  {p.role === 'host' && (
                    <span className="text-[10px] font-semibold text-[#98A0B0]">Host</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* QR Code + Giant Living-Room / Smart TV Code Card */}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 p-4 rounded-2xl bg-[#07080A] border border-white/10 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className="bg-white p-3 rounded-xl">
                <svg
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  role="img"
                  aria-label={`QR code to join room ${roomCode}`}
                  className="w-36 h-36 sm:w-40 sm:h-40 block"
                >
                  <path d={qr.path} fill="#07080A" />
                </svg>
              </div>
              <span className="text-[11px] text-[#98A0B0]">Scan with phone camera</span>
            </div>

            <div className="space-y-3 min-w-0">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
                    <Tv className="w-3.5 h-3.5 text-[#F5F7FA]" />
                    Room Code
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('code', roomCode)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#101216] border border-white/10 text-[11px] font-medium text-[#F5F7FA] hover:border-white/30"
                  >
                    {copiedKind === 'code' ? (
                      <>
                        <Check className="w-3 h-3 text-[#22C55E]" />
                        <span className="text-[#22C55E]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-2xl sm:text-3xl font-mono font-bold tracking-wider text-[#F5F7FA] break-all">
                  {roomCode}
                </p>
                <p className="text-[11px] text-[#98A0B0] mt-1 leading-relaxed">
                  Open <span className="font-mono text-[#F5F7FA]">{hostLabel}</span> on a Smart TV
                  or laptop and enter this code.
                </p>
              </div>

              <div className="pt-2 border-t border-white/8">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#98A0B0] mb-1">
                  Direct Invite Link
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={inviteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#101216] border border-white/10 text-xs font-mono text-[#C6CCD8] truncate hover:border-white/30"
                  >
                    {inviteUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyText('link', inviteUrl)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 shrink-0"
                  >
                    {copiedKind === 'link' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                        <span className="text-[#22C55E]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Share Actions */}
          <div className={`grid gap-2.5 ${supportsNativeShare ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
            {supportsNativeShare && (
              <button
                type="button"
                onClick={() => void handleNativeShare()}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-bold hover:bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Invite…</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void copyText('invite', inviteMessage)}
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                !supportsNativeShare
                  ? 'bg-[#F5F7FA] border-[#F5F7FA] text-[#07080A] hover:bg-white'
                  : 'bg-[#181B22] border-white/10 text-[#F5F7FA] hover:border-white/30'
              }`}
            >
              {copiedKind === 'invite' ? (
                <>
                  <Check className="w-4 h-4 text-[#22C55E]" />
                  <span>Invite Copied ✓</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Full Invite</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void copyText('link', inviteUrl)}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Link2 className="w-4 h-4" />
              <span>{copiedKind === 'link' ? 'Link Copied ✓' : 'Copy Link Only'}</span>
            </button>
          </div>

          {/* One-Tap Group Apps */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
              Send directly via
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <a
                href={channelUrls.whatsapp}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-[#22C55E]/60 transition"
              >
                <MessageCircle className="w-3.5 h-3.5 text-[#22C55E]" />
                <span>WhatsApp</span>
              </a>
              <a
                href={channelUrls.sms}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#F5F7FA]" />
                <span>Messages / SMS</span>
              </a>
              <a
                href={channelUrls.telegram}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition"
              >
                <Send className="w-3.5 h-3.5 text-[#98A0B0]" />
                <span>Telegram</span>
              </a>
              <a
                href={channelUrls.email}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition"
              >
                <Mail className="w-3.5 h-3.5 text-[#C6CCD8]" />
                <span>Email</span>
              </a>
            </div>

            {selfRole === 'host' && hasWebhook && onSendWebhook && (
              <button
                type="button"
                onClick={handleWebhookPost}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#07080A] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition"
              >
                {webhookSent ? (
                  <>
                    <Check className="w-4 h-4 text-[#22C55E]" />
                    <span className="text-[#22C55E]">Posted to Discord / Webhook ✓</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4" />
                    <span>Post Invite to Discord / Webhook</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Formatted Message Preview & Optional PIN Toggle */}
          <div className="p-3 rounded-xl bg-[#07080A] border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
                Invite Message Preview
              </span>
              {hasPin && (
                <label className="flex items-center gap-1.5 text-xs text-[#F5F7FA] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePin}
                    onChange={(e) => setIncludePin(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#F5F7FA]"
                  />
                  <Lock className="w-3 h-3" />
                  <span>Include Room PIN in invite</span>
                </label>
              )}
            </div>

            {hasPin && includePin && (
              <div className="flex items-center gap-2">
                <label htmlFor="invite-pin-input" className="text-[11px] text-[#98A0B0] shrink-0">
                  PIN to share:
                </label>
                <input
                  id="invite-pin-input"
                  type="text"
                  value={pinDraft}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPinDraft(next);
                    saveSessionRoomPin(roomCode, next);
                  }}
                  maxLength={24}
                  placeholder="Enter room PIN"
                  className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-[#101216] border border-white/10 text-xs font-mono text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
                />
              </div>
            )}

            <pre className="text-[11px] font-sans text-[#C6CCD8] whitespace-pre-wrap break-words leading-relaxed bg-[#101216] border border-white/8 rounded-lg p-2.5">
              {inviteMessage}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/8 bg-[#101216] flex flex-wrap items-center justify-between gap-2 shrink-0">
          {selfRole === 'host' ? (
            <div className="flex items-center gap-2">
              {onOpenSwipeMatch && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSwipeMatch();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>Swipe Match</span>
                </button>
              )}
              {onOpenLibrary && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLibrary();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Pick Movie / Show</span>
                </button>
              )}
            </div>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold hover:bg-white"
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
