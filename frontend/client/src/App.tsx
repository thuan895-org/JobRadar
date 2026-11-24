import { useEffect } from 'react';
import { Spinner } from '@jobradar/shared';
import { navigate, useRoute } from './router';
import { SessionProvider, useSession } from './session';
import { Consent, Forgot, Login, Reset, Signup, Verify } from './pages/auth';
import { Home } from './pages/home';
import { Account } from './pages/account';
import { Privacy, Terms } from './pages/legal';

const PUBLIC: Record<string, () => React.JSX.Element> = { '/terms': Terms, '/privacy': Privacy, '/verify': Verify, '/reset': Reset };
const GUEST_ONLY: Record<string, () => React.JSX.Element> = { '/login': Login, '/signup': Signup, '/forgot': Forgot };
const PRIVATE: Record<string, () => React.JSX.Element> = { '/': Home, '/account': Account };

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Routes() {
  const { path } = useRoute();
  const { user, loading } = useSession();
  if (PUBLIC[path]) { const Page = PUBLIC[path]; return <Page />; }
  if (loading) return <div className="grid min-h-screen place-items-center text-brand"><Spinner /></div>;
  if (GUEST_ONLY[path]) { const Page = GUEST_ONLY[path]; return user ? <Redirect to="/" /> : <Page />; }
  if (!user) return <Redirect to="/login" />;
  if (user.needsConsent) return <Consent />;
  const Page = PRIVATE[path];
  return Page ? <Page /> : <Redirect to="/" />;
}

export default function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
