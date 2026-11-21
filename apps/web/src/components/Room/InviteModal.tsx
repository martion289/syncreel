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
    onOpenSwipeMatch
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
        className="w-full max-w-xl max-h-[92dvh] flex flex-col rounded-2xl bg-[#16161A] border border-[#2B2B33] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#2B2B33] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#E5A00D]/15 border border-[#E5A00D]/40 flex items-center justify-center text-[#E5A00D] shrink-0">
              <Share2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="invite-modal-title" className="text-sm sm:text-base font-bold text-[#F4F2EE]">
                Invite Everyone
              </h2>
              <p className="text-xs text-[#9C9AA6] truncate">
                {roomName} — friends don&apos;t need a Plex account
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Invite modal"
            className="p-1.5 rounded-lg text-[#9C9AA6] hover:text-[#F4F2EE] hover:bg-[#202026] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Live "In the Room" Lobby Presence */}
          <div className="p-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9C9AA6]">
                <Users className="w-3.5 h-3.5 text-[#34C77B]" />
                In this room ({participants.length})
              </span>
              {participants.length <= 1 && (
                <span className="text-[11px] text-[#686670]">
                  Friends appear here live as they join
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {participants.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#16161A] border border-[#2B2B33] text-xs text-[#F4F2EE]"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      p.isBuffering ? 'bg-[#E5A00D]' : 'bg-[#34C77B]'
                    }`}
                  />
                  <span>{p.name}</span>
                  {p.role === 'host' && (
                    <span className="text-[10px] font-semibold text-[#E5A00D]">Host</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* QR Code + Giant Living-Room / Smart TV Code Card */}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 p-4 rounded-2xl bg-[#0E0E10] border border-[#2B2B33] items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className="bg-white p-3 rounded-xl shadow-md">
                <svg
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  role="img"
                  aria-label={`QR code to join room ${roomCode}`}
                  className="w-36 h-36 sm:w-40 sm:h-40 block"
                >
                  <path d={qr.path} fill="#0E0E10" />
                </svg>
              </div>
              <span className="text-[11px] text-[#9C9AA6]">Scan with phone camera</span>
            </div>

            <div className="space-y-3 min-w-0">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9C9AA6]">
                    <Tv className="w-3.5 h-3.5 text-[#E5A00D]" />
                    Room Code
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('code', roomCode)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#16161A] border border-[#2B2B33] text-[11px] font-medium text-[#F4F2EE] hover:border-[#E5A00D]/60"
                  >
                    {copiedKind === 'code' ? (
                      <>
                        <Check className="w-3 h-3 text-[#34C77B]" />
                        <span className="text-[#34C77B]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-[#E5A00D]" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-2xl sm:text-3xl font-mono font-bold tracking-wider text-[#E5A00D] break-all">
                  {roomCode}
                </p>
                <p className="text-[11px] text-[#9C9AA6] mt-1 leading-relaxed">
                  Open <span className="font-mono text-[#F4F2EE]">{hostLabel}</span> on a Smart TV
                  or laptop and enter this code.
                </p>
              </div>

              <div className="pt-2 border-t border-[#2B2B33]">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#9C9AA6] mb-1">
                  Direct Invite Link
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={inviteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#16161A] border border-[#2B2B33] text-xs font-mono text-[#D4D2DC] truncate hover:border-[#E5A00D]/60"
                  >
                    {inviteUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyText('link', inviteUrl)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#202026] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D] shrink-0"
                  >
                    {copiedKind === 'link' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#34C77B]" />
                        <span className="text-[#34C77B]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3.5 h-3.5 text-[#E5A00D]" />
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
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#E5A00D] text-[#111113] text-xs font-bold hover:bg-[#f0ad1c] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Invite…</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void copyText('invite', inviteMessage)}
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D] ${
                !supportsNativeShare
                  ? 'bg-[#E5A00D] border-[#E5A00D] text-[#111113] hover:bg-[#f0ad1c]'
                  : 'bg-[#202026] border-[#2B2B33] text-[#F4F2EE] hover:border-[#E5A00D]'
              }`}
            >
              {copiedKind === 'invite' ? (
                <>
                  <Check className="w-4 h-4 text-[#34C77B]" />
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
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D]/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
            >
              <Link2 className="w-4 h-4 text-[#E5A00D]" />
              <span>{copiedKind === 'link' ? 'Link Copied ✓' : 'Copy Link Only'}</span>
            </button>
          </div>

          {/* One-Tap Group Apps ("Include Everyone") */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9C9AA6]">
              Send directly via
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <a
                href={channelUrls.whatsapp}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#34C77B]/70 transition"
              >
                <MessageCircle className="w-3.5 h-3.5 text-[#34C77B]" />
                <span>WhatsApp</span>
              </a>
              <a
                href={channelUrls.sms}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D]/70 transition"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#E5A00D]" />
                <span>Messages / SMS</span>
              </a>
              <a
                href={channelUrls.telegram}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-sky-400/70 transition"
              >
                <Send className="w-3.5 h-3.5 text-sky-400" />
                <span>Telegram</span>
              </a>
              <a
                href={channelUrls.email}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#9C9AA6] transition"
              >
                <Mail className="w-3.5 h-3.5 text-[#D4D2DC]" />
                <span>Email</span>
              </a>
            </div>

            {selfRole === 'host' && hasWebhook && onSendWebhook && (
              <button
                type="button"
                onClick={handleWebhookPost}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D] transition"
              >
                {webhookSent ? (
                  <>
                    <Check className="w-4 h-4 text-[#34C77B]" />
                    <span className="text-[#34C77B]">Posted to Discord / Webhook ✓</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4 text-[#E5A00D]" />
                    <span>Post Invite to Discord / Webhook</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Formatted Message Preview & Optional PIN Toggle */}
          <div className="p-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9C9AA6]">
                Invite Message Preview
              </span>
              {hasPin && (
                <label className="flex items-center gap-1.5 text-xs text-[#F4F2EE] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePin}
                    onChange={(e) => setIncludePin(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#E5A00D]"
                  />
                  <Lock className="w-3 h-3 text-[#E5A00D]" />
                  <span>Include Room PIN in invite</span>
                </label>
              )}
            </div>

            {hasPin && includePin && (
              <div className="flex items-center gap-2">
                <label htmlFor="invite-pin-input" className="text-[11px] text-[#9C9AA6] shrink-0">
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
                  className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-[#16161A] border border-[#2B2B33] text-xs font-mono text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
                />
              </div>
            )}

            <pre className="text-[11px] font-sans text-[#D4D2DC] whitespace-pre-wrap break-words leading-relaxed bg-[#16161A] border border-[#2B2B33]/80 rounded-lg p-2.5">
              {inviteMessage}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2B2B33] bg-[#16161A] flex flex-wrap items-center justify-between gap-2 shrink-0">
          {selfRole === 'host' ? (
            <div className="flex items-center gap-2">
              {onOpenSwipeMatch && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSwipeMatch();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202026] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D]"
                >
                  <Flame className="w-3.5 h-3.5 text-[#E5A00D]" />
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202026] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D]"
                >
                  <Film className="w-3.5 h-3.5 text-[#E5A00D]" />
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
            className="px-4 py-1.5 rounded-lg bg-[#E5A00D] text-[#111113] text-xs font-semibold hover:bg-[#f0ad1c]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
