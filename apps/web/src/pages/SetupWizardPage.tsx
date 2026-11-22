import { useEffect, useRef, useState } from 'react';
import type { AuthUser, DiscoveredPlexServer } from '@syncreel/shared';
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
  Wifi
} from 'lucide-react';
import { api } from '../lib/api.js';
import {
  consumeReturnedAuthPin,
  getCurrentReturnPath,
  resolveSetupPinFromReturn,
  savePendingAuthPin,
  type ReturnedAuthPin
} from '../lib/plexAuthReturn.js';

interface SetupWizardPageProps {
  onSetupComplete: (user: AuthUser) => void;
}

export function SetupWizardPage({ onSetupComplete }: SetupWizardPageProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [completingSignIn, setCompletingSignIn] = useState(false);
  const [redirectingAuth, setRedirectingAuth] = useState(false);
  const [setupTicket, setSetupTicket] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [servers, setServers] = useState<DiscoveredPlexServer[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string>('');
  const [customUrl, setCustomUrl] = useState<string>('');
  const [allowPlexFriends, setAllowPlexFriends] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookAutoNotify, setWebhookAutoNotify] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnedPinRef = useRef<ReturnedAuthPin | null | undefined>(undefined);

  useEffect(() => {
    if (step !== 1) return;
    if (returnedPinRef.current === undefined) {
      returnedPinRef.current = consumeReturnedAuthPin('setup');
    }
    const returned = returnedPinRef.current;
    if (!returned) return;

    let cancelled = false;
    setCompletingSignIn(true);
    resolveSetupPinFromReturn(returned, api.pollSetupPin)
      .then(({ result, error: claimErr }) => {
        if (cancelled) return;
        if (result?.claimed && result.setupTicket) {
          setSetupTicket(result.setupTicket);
          setUsername(result.username || 'Server Owner');
          const foundServers = result.servers ?? [];
          setServers(foundServers);
          const firstReachable = foundServers
            .flatMap((s) => s.connections)
            .find((c) => c.reachable);
          const firstAny = foundServers.flatMap((s) => s.connections)[0];
          setSelectedUrl(firstReachable?.uri || firstAny?.uri || '');
          setStep(2);
          return;
        }
        if (claimErr) {
          setError(claimErr);
        }
      })
      .finally(() => {
        if (!cancelled) setCompletingSignIn(false);
      });

    return () => {
      cancelled = true;
    };
  }, [step]);

  const startAccountSignIn = async () => {
    setError(null);
    setRedirectingAuth(true);
    try {
      const pin = await api.createSetupPin(getCurrentReturnPath());
      savePendingAuthPin('setup', pin.id);
      window.location.assign(pin.authUrl);
    } catch (err) {
      setRedirectingAuth(false);
      setError(err instanceof Error ? err.message : 'Failed to start sign-in');
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
      setError(err instanceof Error ? err.message : 'Failed to probe media servers');
    } finally {
      setBusy(false);
    }
  };

  const finishSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupTicket) return;
    const finalUrl = (customUrl.trim() || selectedUrl).trim();
    if (!finalUrl) {
      setError('Select a media server URL or enter one manually');
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
    <div className="min-h-screen bg-[#07080A] text-[#F5F7FA] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-xl rounded-2xl bg-[#101216] border border-white/10 p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="w-9 h-9 rounded-lg" />
            <div>
              <h1 className="font-display text-lg font-bold text-[#F5F7FA]">Welcome to SyncReel</h1>
              <p className="text-xs text-[#98A0B0]">First-time server setup • Step {step} of 3</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3].map((s) => (
              <span
                key={s}
                className={`w-6 h-1.5 rounded-full ${
                  s <= step ? 'bg-[#F5F7FA]' : 'bg-[#181B22]'
                }`}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-[#F43F5E]/10 border border-[#F43F5E]/30 text-xs text-[#F43F5E]">
            {error}
          </div>
        )}

        {/* Step 1: Account OAuth */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              Connect your media server owner account
            </h2>
            <p className="text-sm text-[#98A0B0] leading-relaxed">
              Sign in with the account that owns your Media Server. SyncReel will automatically
              discover your server connections and configure encrypted local storage.
            </p>

            {completingSignIn ? (
              <div className="p-4 rounded-xl bg-[#07080A] border border-white/10">
                <div className="flex items-center gap-2.5 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-[#F5F7FA]" />
                  <span>Completing sign-in…</span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={redirectingAuth}
                onClick={() => void startAccountSignIn()}
                className="w-full py-3 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {redirectingAuth ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Redirecting to sign in…</span>
                  </>
                ) : (
                  <span>Sign in with Media Account</span>
                )}
              </button>
            )}
          </div>
        )}

        {/* Step 2: Server Selection */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
                  Select Media Server
                </h2>
                <p className="text-xs text-[#98A0B0]">Signed in as {username}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshServers()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs text-[#F5F7FA]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                <span>Re-probe</span>
              </button>
            </div>

            {servers.length === 0 ? (
              <p className="text-xs text-[#98A0B0]">
                No owned media servers were returned automatically. Enter your server URL below.
              </p>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {servers.map((srv) => (
                  <div
                    key={srv.machineIdentifier}
                    className="p-3 rounded-xl bg-[#07080A] border border-white/10 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#F5F7FA]">
                      <Server className="w-3.5 h-3.5" />
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
                                ? 'bg-white/10 border-[#F5F7FA] text-[#F5F7FA]'
                                : 'bg-[#101216] border-white/10 text-[#98A0B0] hover:text-[#F5F7FA]'
                            }`}
                          >
                            <span className="font-mono truncate">{c.uri}</span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {c.reachable ? (
                                <span className="inline-flex items-center gap-1 text-[#22C55E] font-mono text-[10px]">
                                  <Wifi className="w-3 h-3" />
                                  {c.latencyMs}ms
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#5C6475]">Unreachable</span>
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
              <label className="block text-xs font-medium text-[#98A0B0] mb-1">
                Or enter custom server URL
              </label>
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="http://192.168.1.50:32400"
                className="w-full px-3 py-2 rounded-xl bg-[#07080A] border border-white/10 text-xs font-mono text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
              />
            </div>

            <button
              type="button"
              disabled={!customUrl.trim() && !selectedUrl}
              onClick={() => setStep(3)}
              className="w-full py-3 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 3: Defaults & Finish */}
        {step === 3 && (
          <form onSubmit={finishSetup} className="space-y-4">
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              Room Defaults &amp; Notifications
            </h2>

            <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#07080A] border border-white/10 cursor-pointer">
              <input
                type="checkbox"
                checked={allowPlexFriends}
                onChange={(e) => setAllowPlexFriends(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#F5F7FA]"
              />
              <div>
                <p className="text-xs font-semibold text-[#F5F7FA]">
                  Allow Shared Library Friends to host rooms
                </p>
                <p className="text-[11px] text-[#98A0B0] mt-0.5">
                  Anyone you share your media library with can sign in and start rooms using their
                  own permissions. (Invite-link guests still need zero accounts.)
                </p>
              </div>
            </label>

            <div className="p-3.5 rounded-xl bg-[#07080A] border border-white/10 space-y-2.5">
              <label className="block text-xs font-semibold text-[#F5F7FA]">
                Discord / Webhook URL (Optional)
              </label>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 rounded-lg bg-[#101216] border border-white/10 text-xs text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
              />
              <label className="flex items-center gap-2 text-xs text-[#98A0B0] cursor-pointer">
                <input
                  type="checkbox"
                  checked={webhookAutoNotify}
                  onChange={(e) => setWebhookAutoNotify(e.target.checked)}
                  className="w-4 h-4 accent-[#F5F7FA]"
                />
                <span>Auto-announce when a movie or show loads</span>
              </label>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2.5 rounded-xl bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA]"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Finish &amp; Launch SyncReel</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        <div className="pt-3 border-t border-white/8 flex items-center gap-2 text-[11px] text-[#5C6475]">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />
          <span>Secrets and session tokens stay encrypted locally on your server.</span>
        </div>
      </div>
    </div>
  );
}
