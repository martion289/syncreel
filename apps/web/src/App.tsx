import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '@syncreel/shared';
import { Loader2 } from 'lucide-react';
import { api } from './lib/api.js';
import { HomePage } from './pages/HomePage.js';
import { JoinRoomPage } from './pages/JoinRoomPage.js';
import { RoomPage } from './pages/RoomPage.js';
import { SetupWizardPage } from './pages/SetupWizardPage.js';

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
      <div className="min-h-screen bg-[#0E0E10] flex items-center justify-center text-[#9C9AA6] gap-2 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#E5A00D]" />
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

  return <HomePage onNavigate={navigate} initialUser={wizardUser} />;
}
