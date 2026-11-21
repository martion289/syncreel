import { useEffect, useState } from 'react';
import type { AdminOverview } from '@syncreel/shared';
import {
  Activity,
  Bell,
  CheckCircle2,
  Loader2,
  Save,
  Shield,
  Square,
  Trash2,
  X
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatTimeMs } from '../../lib/format.js';

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
}

export function AdminModal({ open, onClose }: AdminModalProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [plexUrl, setPlexUrl] = useState('');
  const [allowPlexFriends, setAllowPlexFriends] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookAutoNotify, setWebhookAutoNotify] = useState(false);
  const [defaultHostOnlyControl, setDefaultHostOnlyControl] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .getAdminOverview()
      .then((res) => {
        setOverview(res);
        setPlexUrl(res.settings.plexUrl);
        setAllowPlexFriends(res.settings.allowPlexFriends);
        setWebhookUrl(res.settings.webhookUrl);
        setWebhookAutoNotify(res.settings.webhookAutoNotify);
        setDefaultHostOnlyControl(res.settings.defaultHostOnlyControl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load admin overview'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    load();
  }, [open]);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateAdminSettings({
        plexUrl: plexUrl.trim(),
        allowPlexFriends,
        webhookUrl: webhookUrl.trim(),
        webhookAutoNotify,
        defaultHostOnlyControl
      });
      setNotice('Settings saved.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setError(null);
    setNotice(null);
    try {
      await api.testWebhook(webhookUrl.trim());
      setNotice('Test notification delivered!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook test failed');
    } finally {
      setTestingWebhook(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl bg-[#16161A] border border-[#2B2B33] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2B2B33]">
          <div className="flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-[#E5A00D]" />
            <h2 className="text-base font-semibold text-[#F4F2EE]">SyncReel Server Admin</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close admin panel"
            className="p-2 rounded-lg text-[#9C9AA6] hover:text-[#F4F2EE] hover:bg-[#202026] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && !overview ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-[#9C9AA6]">
              <Loader2 className="w-4 h-4 animate-spin text-[#E5A00D]" />
              <span>Loading server overview…</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 rounded-xl bg-[#D94848]/10 border border-[#D94848]/40 text-xs text-[#D94848]">
                  {error}
                </div>
              )}
              {notice && (
                <div className="p-3 rounded-xl bg-[#34C77B]/10 border border-[#34C77B]/40 text-xs text-[#34C77B] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{notice}</span>
                </div>
              )}

              {/* Settings Form */}
              <form
                onSubmit={handleSave}
                className="rounded-xl bg-[#0E0E10] border border-[#2B2B33] p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#9C9AA6]">
                    Server & Permissions
                  </h3>
                  <span className="text-[11px] text-[#34C77B]">
                    {overview?.settings.serverName}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9C9AA6] mb-1">
                    Plex Server URL
                  </label>
                  <input
                    type="url"
                    required
                    value={plexUrl}
                    onChange={(e) => setPlexUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#16161A] border border-[#2B2B33] text-xs font-mono text-[#F4F2EE] focus:outline-none focus:border-[#E5A00D]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[#16161A] border border-[#2B2B33] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowPlexFriends}
                      onChange={(e) => setAllowPlexFriends(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#E5A00D]"
                    />
                    <div>
                      <p className="text-xs font-medium text-[#F4F2EE]">Allow Plex Friends to Host</p>
                      <p className="text-[11px] text-[#9C9AA6]">
                        Shared Plex users can sign in and host rooms with their library permissions
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[#16161A] border border-[#2B2B33] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={defaultHostOnlyControl}
                      onChange={(e) => setDefaultHostOnlyControl(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#E5A00D]"
                    />
                    <div>
                      <p className="text-xs font-medium text-[#F4F2EE]">Default Host-Only Lock</p>
                      <p className="text-[11px] text-[#9C9AA6]">
                        New rooms start with guest play/pause/seek locked
                      </p>
                    </div>
                  </label>
                </div>

                <div className="space-y-2 pt-2 border-t border-[#2B2B33]">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#F4F2EE]">
                    <Bell className="w-3.5 h-3.5 text-[#E5A00D]" />
                    <span>Discord / Generic Webhook</span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://discord.com/api/webhooks/..."
                      className="flex-1 px-3 py-2 rounded-lg bg-[#16161A] border border-[#2B2B33] text-xs text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
                    />
                    <button
                      type="button"
                      disabled={!webhookUrl.trim() || testingWebhook}
                      onClick={() => void handleTestWebhook()}
                      className="px-3 py-2 rounded-lg bg-[#202026] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D] disabled:opacity-50"
                    >
                      {testingWebhook ? 'Sending…' : 'Send Test'}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#9C9AA6] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={webhookAutoNotify}
                      onChange={(e) => setWebhookAutoNotify(e.target.checked)}
                      className="w-4 h-4 accent-[#E5A00D]"
                    />
                    <span>Auto-post webhook notification whenever a movie or episode loads</span>
                  </label>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E5A00D] text-[#111113] text-xs font-semibold hover:bg-[#f0ad1c] disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving…' : 'Save Settings'}</span>
                  </button>
                </div>
              </form>

              {/* Active Rooms */}
              <div className="rounded-xl bg-[#0E0E10] border border-[#2B2B33] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#9C9AA6]">
                    Active Screening Rooms ({overview?.rooms.length ?? 0})
                  </h3>
                  <button onClick={load} className="text-[11px] text-[#E5A00D] hover:underline">
                    Refresh
                  </button>
                </div>

                {overview && overview.rooms.length === 0 ? (
                  <p className="text-xs text-[#686670]">No active rooms right now.</p>
                ) : (
                  <div className="space-y-2">
                    {overview?.rooms.map((r) => (
                      <div
                        key={r.code}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#16161A] border border-[#2B2B33]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#F4F2EE] truncate">
                            {r.name}{' '}
                            <span className="font-mono text-[#E5A00D] ml-1">{r.code}</span>
                          </p>
                          <p className="text-[11px] text-[#9C9AA6] truncate">
                            {r.participantCount} viewer{r.participantCount === 1 ? '' : 's'} •{' '}
                            {r.streamMode === 'eco-shared' ? 'Eco Shared' : 'Per-Viewer'}
                            {r.currentMediaTitle ? ` • ${r.currentMediaTitle}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            await api.adminCloseRoom(r.code);
                            load();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#D94848]/15 text-[#D94848] text-xs font-medium hover:bg-[#D94848]/25"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active Plex Transcodes / Streams */}
              <div className="rounded-xl bg-[#0E0E10] border border-[#2B2B33] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-[#E5A00D]" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#9C9AA6]">
                    Active Plex Streams ({overview?.streams.length ?? 0})
                  </h3>
                </div>

                {overview && overview.streams.length === 0 ? (
                  <p className="text-xs text-[#686670]">No active HLS streams.</p>
                ) : (
                  <div className="space-y-2">
                    {overview?.streams.map((s) => (
                      <div
                        key={s.streamToken}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#16161A] border border-[#2B2B33]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#F4F2EE] truncate">
                            {s.mediaTitle}
                          </p>
                          <p className="text-[11px] text-[#9C9AA6] font-mono truncate">
                            Room {s.roomCode} • {s.quality} •{' '}
                            {s.streamMode === 'eco-shared' ? 'Eco' : 'Individual'} • Seen{' '}
                            {formatTimeMs(Math.max(0, Date.now() - s.lastSeenAtMs))} ago
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            await api.adminKillStream(s.streamToken);
                            load();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#D94848]/15 text-[#D94848] text-xs font-medium hover:bg-[#D94848]/25"
                        >
                          <Square className="w-3 h-3 fill-current" />
                          <span>Stop</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
