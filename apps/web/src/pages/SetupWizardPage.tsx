import { useEffect, useState } from 'react';
import type { AuthUser, DiscoveredPlexServer } from '@syncreel/shared';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
  Wifi
} from 'lucide-react';
import { api } from '../lib/api.js';

interface SetupWizardPageProps {
  onSetupComplete: (user: AuthUser) => void;
}

export function SetupWizardPage({ onSetupComplete }: SetupWizardPageProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pinId, setPinId] = useState<number | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [setupTicket, setSetupTicket] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [servers, setServers] = useState<DiscoveredPlexServer[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string>('');
  const [customUrl, setCustomUrl] = useState<string>('');
  const [allowPlexFriends, setAllowPlexFriends] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookAutoNotify, setWebhookAutoNotify] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pinId || step !== 1) return;
    let cancelled = false;

    const timer = window.setInterval(async () => {
      try {
        const res = await api.pollSetupPin(pinId);
        if (!cancelled && res.claimed && res.setupTicket) {
          setSetupTicket(res.setupTicket);
          setUsername(res.username || 'Plex Owner');
          const foundServers = res.servers ?? [];
          setServers(foundServers);
          const firstReachable = foundServers
            .flatMap((s) => s.connections)
            .find((c) => c.reachable);
          const firstAny = foundServers.flatMap((s) => s.connections)[0];
          setSelectedUrl(firstReachable?.uri || firstAny?.uri || '');
          setPinId(null);
          setStep(2);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Plex sign-in failed');
          setPinId(null);
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pinId, step]);

  const startPlexSignIn = async () => {
    setError(null);
    try {
      const pin = await api.createSetupPin();
      setPinId(pin.id);
      setAuthUrl(pin.authUrl);
      window.open(pin.authUrl, 'syncreel-setup-plex', 'width=640,height=740,noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Plex PIN');
    }
  };

  const refreshServers = async () => {
    if (!setupTicket) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.rediscoverServers(setupTicket);
      setServers(res.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to probe Plex servers');
    } finally {
      setBusy(false);
    }
  };

  const finishSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupTicket) return;
    const finalUrl = (customUrl.trim() || selectedUrl).trim();
    if (!finalUrl) {
      setError('Select a Plex server URL or enter one manually');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await api.completeSetup({
        setupTicket,
        plexUrl: finalUrl,
        allowPlexFriends,
        webhookUrl: webhookUrl.trim() || undefined,
        webhookAutoNotify
      });
      onSetupComplete(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0E0E10] text-[#F4F2EE] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-xl rounded-2xl bg-[#16161A] border border-[#2B2B33] p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="w-9 h-9 rounded-lg" />
            <div>
              <h1 className="text-lg font-bold text-[#F4F2EE]">Welcome to SyncReel</h1>
              <p className="text-xs text-[#9C9AA6]">First-time server setup • Step {step} of 3</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3].map((s) => (
              <span
                key={s}
                className={`w-6 h-1.5 rounded-full ${
                  s <= step ? 'bg-[#E5A00D]' : 'bg-[#2B2B33]'
                }`}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-[#D94848]/10 border border-[#D94848]/40 text-xs text-[#D94848]">
            {error}
          </div>
        )}

        {/* Step 1: Plex OAuth */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-[#F4F2EE]">
              Connect your Plex Server Owner account
            </h2>
            <p className="text-sm text-[#9C9AA6] leading-relaxed">
              Sign in with the Plex account that owns your Media Server. SyncReel will automatically
              discover your server connections and configure encrypted local storage.
            </p>

            {pinId ? (
              <div className="p-4 rounded-xl bg-[#0E0E10] border border-[#2B2B33] space-y-3">
                <div className="flex items-center gap-2.5 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-[#E5A00D]" />
                  <span>Waiting for Plex sign-in…</span>
                </div>
                {authUrl && (
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#E5A00D] hover:underline"
                  >
                    <span>Open Plex sign-in page</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <button
                onClick={() => void startPlexSignIn()}
                className="w-full py-3 rounded-xl bg-[#E5A00D] text-[#111113] font-semibold text-sm hover:bg-[#f0ad1c] transition"
              >
                Sign in with Plex
              </button>
            )}
          </div>
        )}

        {/* Step 2: Server Selection */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#F4F2EE]">Select Plex Media Server</h2>
                <p className="text-xs text-[#9C9AA6]">Signed in as {username}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshServers()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#202026] text-xs text-[#F4F2EE]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                <span>Re-probe</span>
              </button>
            </div>

            {servers.length === 0 ? (
              <p className="text-xs text-[#9C9AA6]">
                No owned Plex servers were returned automatically. Enter your Plex server URL
                below.
              </p>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {servers.map((srv) => (
                  <div
                    key={srv.machineIdentifier}
                    className="p-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] space-y-2"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#F4F2EE]">
                      <Server className="w-3.5 h-3.5 text-[#E5A00D]" />
                      <span>{srv.name}</span>
                    </div>
                    <div className="space-y-1.5">
                      {srv.connections.map((c) => {
                        const active = selectedUrl === c.uri && !customUrl.trim();
                        return (
                          <button
                            key={c.uri}
                            type="button"
                            onClick={() => {
                              setCustomUrl('');
                              setSelectedUrl(c.uri);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs border transition ${
                              active
                                ? 'bg-[#E5A00D]/15 border-[#E5A00D] text-[#F4F2EE]'
                                : 'bg-[#16161A] border-[#2B2B33] text-[#9C9AA6] hover:text-[#F4F2EE]'
                            }`}
                          >
                            <span className="font-mono truncate">{c.uri}</span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {c.reachable ? (
                                <span className="inline-flex items-center gap-1 text-[#34C77B] font-mono text-[10px]">
                                  <Wifi className="w-3 h-3" />
                                  {c.latencyMs}ms
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#686670]">Unreachable</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#9C9AA6] mb-1">
                Or enter custom Plex URL
              </label>
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="http://192.168.1.50:32400"
                className="w-full px-3 py-2 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-mono text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
              />
            </div>

            <button
              type="button"
              disabled={!customUrl.trim() && !selectedUrl}
              onClick={() => setStep(3)}
              className="w-full py-3 rounded-xl bg-[#E5A00D] text-[#111113] font-semibold text-sm hover:bg-[#f0ad1c] disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 3: Defaults & Finish */}
        {step === 3 && (
          <form onSubmit={finishSetup} className="space-y-4">
            <h2 className="text-base font-semibold text-[#F4F2EE]">Room Defaults & Notifications</h2>

            <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#0E0E10] border border-[#2B2B33] cursor-pointer">
              <input
                type="checkbox"
                checked={allowPlexFriends}
                onChange={(e) => setAllowPlexFriends(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#E5A00D]"
              />
              <div>
                <p className="text-xs font-semibold text-[#F4F2EE]">
                  Allow Plex Friends to host rooms
                </p>
                <p className="text-[11px] text-[#9C9AA6] mt-0.5">
                  Anyone you already share your Plex server with can sign in and start rooms using
                  their own library permissions. (Invite-link guests still need zero accounts.)
                </p>
              </div>
            </label>

            <div className="p-3.5 rounded-xl bg-[#0E0E10] border border-[#2B2B33] space-y-2.5">
              <label className="block text-xs font-semibold text-[#F4F2EE]">
                Discord / Webhook URL (Optional)
              </label>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 rounded-lg bg-[#16161A] border border-[#2B2B33] text-xs text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
              />
              <label className="flex items-center gap-2 text-xs text-[#9C9AA6] cursor-pointer">
                <input
                  type="checkbox"
                  checked={webhookAutoNotify}
                  onChange={(e) => setWebhookAutoNotify(e.target.checked)}
                  className="w-4 h-4 accent-[#E5A00D]"
                />
                <span>Auto-announce when a movie or show loads</span>
              </label>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2.5 rounded-xl bg-[#202026] text-xs font-medium text-[#F4F2EE]"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-[#E5A00D] text-[#111113] font-semibold text-sm hover:bg-[#f0ad1c] disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Finish & Launch SyncReel</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        <div className="pt-3 border-t border-[#2B2B33] flex items-center gap-2 text-[11px] text-[#686670]">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#34C77B]" />
          <span>Secrets and Plex tokens stay encrypted locally on your server.</span>
        </div>
      </div>
    </div>
  );
}
