import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '@syncreel/shared';
import { Loader2 } from 'lucide-react';
import { api } from './lib/api.js';
import { HomePage } from './pages/HomePage.js';
import { JoinRoomPage } from './pages/JoinRoomPage.js';
import { RoomPage } from './pages/RoomPage.js';
import { SetupWizardPage } from './pages/SetupWizardPage.js';
import { StandalonePickerPage } from './pages/StandalonePickerPage.js';

function parseRoomCode(pathname: string): string | null {
  const match = pathname.match(/^\/room\/([A-Za-z0-9-]+)/i);
  return match ? match[1] : null;
}

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [authorizedRoom, setAuthorizedRoom] = useState<string | null>(null);
  const [setupConfigured, setSetupConfigured] = useState<boolean | null>(null);
  const [wizardUser, setWizardUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    api
      .getSetupStatus()
      .then((res) => setSetupConfigured(res.configured))
      .catch(() => setSetupConfigured(true));
  }, []);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, '', nextPath);
    setPathname(new URL(nextPath, window.location.origin).pathname);
  }, []);

  const roomCode = parseRoomCode(pathname);
  if (roomCode) {
    if (authorizedRoom && authorizedRoom.toLowerCase() === roomCode.toLowerCase()) {
      return (
        <RoomPage
          roomCode={roomCode}
          onBackHome={() => {
            setAuthorizedRoom(null);
            navigate('/');
          }}
          onRequireJoin={() => setAuthorizedRoom(null)}
        />
      );
    }

    return (
      <JoinRoomPage
        roomCode={roomCode}
        onAuthorized={() => setAuthorizedRoom(roomCode)}
        onBackHome={() => navigate('/')}
      />
    );
  }

  if (setupConfigured === null) {
    return (
      <div className="min-h-screen bg-[#07080A] flex items-center justify-center text-[#98A0B0] gap-2 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#F5F7FA]" />
        <span>Starting SyncReel…</span>
      </div>
    );
  }

  if (!setupConfigured) {
    return (
      <SetupWizardPage
        onSetupComplete={(user) => {
          setWizardUser(user);
          setSetupConfigured(true);
        }}
      />
    );
  }

  const isSwipeSubdomain =
    typeof window !== 'undefined' && window.location.hostname.toLowerCase().startsWith('swipe.');
  if (pathname === '/swipe' || (isSwipeSubdomain && pathname === '/')) {
    return <StandalonePickerPage onNavigate={navigate} initialUser={wizardUser} />;
  }

  return <HomePage onNavigate={navigate} initialUser={wizardUser} />;
}
