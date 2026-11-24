import { useEffect, useState } from 'react';
import { Card, Logo, ServerStatus, serverHealthy } from '@jobradar/shared';

// Placeholder until the admin pages are built (users, reports, sources, AI usage, blog).
const SECTIONS = ['Người dùng', 'Báo cáo job', 'Nguồn job', 'Chi phí AI', 'Blog'];

export default function App() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { serverHealthy().then(setOk); }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo suffix="Admin" />
          <ServerStatus ok={ok} />
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((name) => (
          <Card key={name}>
            <p className="font-medium">{name}</p>
            <p className="mt-1 text-sm text-muted">Sắp có.</p>
          </Card>
        ))}
      </main>
    </div>
  );
}
