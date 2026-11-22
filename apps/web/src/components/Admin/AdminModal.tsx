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
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl bg-[#101216] border border-white/12 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-[#F5F7FA]" />
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              SyncReel Server Admin
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close admin panel"
            className="p-2 rounded-lg text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#181B22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && !overview ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-[#98A0B0]">
              <Loader2 className="w-4 h-4 animate-spin text-[#F5F7FA]" />
              <span>Loading server overview…</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 rounded-xl bg-[#F43F5E]/10 border border-[#F43F5E]/30 text-xs text-[#F43F5E]">
                  {error}
                </div>
              )}
              {notice && (
                <div className="p-3 rounded-xl bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{notice}</span>
                </div>
              )}

              {/* Settings Form */}
              <form
                onSubmit={handleSave}
                className="rounded-xl bg-[#07080A] border border-white/10 p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#98A0B0]">
                    Server &amp; Permissions
                  </h3>
                  <span className="text-[11px] text-[#22C55E]">
                    {overview?.settings.serverName}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#98A0B0] mb-1">
                    Media Server URL
                  </label>
                  <input
                    type="url"
                    required
                    value={plexUrl}
                    onChange={(e) => setPlexUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#101216] border border-white/10 text-xs font-mono text-[#F5F7FA] focus:outline-none focus:border-white/30"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[#101216] border border-white/10 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowPlexFriends}
                      onChange={(e) => setAllowPlexFriends(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#F5F7FA]"
                    />
                    <div>
                      <p className="text-xs font-medium text-[#F5F7FA]">
                        Allow Shared Library Friends to Host
                      </p>
                      <p className="text-[11px] text-[#98A0B0]">
                        Shared library users can sign in and host rooms with their library permissions
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[#101216] border border-white/10 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={defaultHostOnlyControl}
                      onChange={(e) => setDefaultHostOnlyControl(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#F5F7FA]"
                    />
                    <div>
                      <p className="text-xs font-medium text-[#F5F7FA]">Default Host-Only Lock</p>
                      <p className="text-[11px] text-[#98A0B0]">
                        New rooms start with guest play/pause/seek locked
                      </p>
                    </div>
                  </label>
                </div>

                <div className="space-y-2 pt-2 border-t border-white/8">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#F5F7FA]">
                    <Bell className="w-3.5 h-3.5" />
                    <span>Discord / Generic Webhook</span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://discord.com/api/webhooks/..."
                      className="flex-1 px-3 py-2 rounded-lg bg-[#101216] border border-white/10 text-xs text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="button"
                      disabled={!webhookUrl.trim() || testingWebhook}
                      onClick={() => void handleTestWebhook()}
                      className="px-3 py-2 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 disabled:opacity-50"
                    >
                      {testingWebhook ? 'Sending…' : 'Send Test'}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#98A0B0] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={webhookAutoNotify}
                      onChange={(e) => setWebhookAutoNotify(e.target.checked)}
                      className="w-4 h-4 accent-[#F5F7FA]"
                    />
                    <span>Auto-post webhook notification whenever a movie or episode loads</span>
                  </label>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold hover:bg-white disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving…' : 'Save Settings'}</span>
                  </button>
                </div>
              </form>

              {/* Active Rooms */}
              <div className="rounded-xl bg-[#07080A] border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#98A0B0]">
                    Active Screening Rooms ({overview?.rooms.length ?? 0})
                  </h3>
                  <button onClick={load} className="text-[11px] text-[#F5F7FA] hover:underline">
                    Refresh
                  </button>
                </div>

                {overview && overview.rooms.length === 0 ? (
                  <p className="text-xs text-[#5C6475]">No active rooms right now.</p>
                ) : (
                  <div className="space-y-2">
                    {overview?.rooms.map((r) => (
                      <div
                        key={r.code}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#101216] border border-white/10"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#F5F7FA] truncate">
                            {r.name}{' '}
                            <span className="font-mono text-[#98A0B0] ml-1">{r.code}</span>
                          </p>
                          <p className="text-[11px] text-[#98A0B0] truncate">
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#F43F5E]/15 text-[#F43F5E] text-xs font-medium hover:bg-[#F43F5E]/25"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active Streams */}
              <div className="rounded-xl bg-[#07080A] border border-white/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-[#F5F7FA]" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#98A0B0]">
                    Active Streams ({overview?.streams.length ?? 0})
                  </h3>
                </div>

                {overview && overview.streams.length === 0 ? (
                  <p className="text-xs text-[#5C6475]">No active HLS streams.</p>
                ) : (
                  <div className="space-y-2">
                    {overview?.streams.map((s) => (
                      <div
                        key={s.streamToken}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#101216] border border-white/10"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#F5F7FA] truncate">
                            {s.mediaTitle}
                          </p>
                          <p className="text-[11px] text-[#98A0B0] font-mono truncate">
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#F43F5E]/15 text-[#F43F5E] text-xs font-medium hover:bg-[#F43F5E]/25"
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
