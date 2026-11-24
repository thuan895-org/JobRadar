import { useEffect } from 'react';
import { Spinner } from '@jobradar/shared';
import { navigate, useRoute } from './router';
import { SessionProvider, useSession } from './session';
import { Consent, Forgot, Login, Reset, Signup, Verify } from './pages/auth';
import { FeedPage } from './pages/feed';
import { Account } from './pages/account';
import { Onboarding, ProfilePage } from './pages/profile';
import { CheckoutPage, PricingPage, TelegramPage } from './pages/plans';
import { ApplicantsPage, EmployerPage, JobDetailPage, MyApplicationsPage } from './pages/recruit';
import { Privacy, Terms } from './pages/legal';

const PUBLIC: Record<string, () => React.JSX.Element> = { '/terms': Terms, '/privacy': Privacy, '/verify': Verify, '/reset': Reset };
const GUEST_ONLY: Record<string, () => React.JSX.Element> = { '/login': Login, '/signup': Signup, '/forgot': Forgot };
const PRIVATE: Record<string, () => React.JSX.Element> = { '/': FeedPage, '/account': Account, '/onboarding': Onboarding, '/profile': ProfilePage, '/pricing': PricingPage, '/checkout': CheckoutPage, '/telegram': TelegramPage, '/employer': EmployerPage, '/applications': MyApplicationsPage };

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
  const job = path.match(/^\/jobs\/([a-z0-9]{12})$/);
  if (job) return <JobDetailPage postId={job[1]} />;
  const applicants = path.match(/^\/employer\/([a-z0-9]{12})$/);
  if (applicants) return <ApplicantsPage postId={applicants[1]} />;
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
