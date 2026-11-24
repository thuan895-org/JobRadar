import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Card, Field, api, type User } from '@jobradar/shared';
import { AppLayout } from '../layouts';
import { navigate } from '../router';
import { useSession } from '../session';

function Section({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <Card className="grid gap-6 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {text && <p className="mt-1 text-sm text-muted">{text}</p>}
      </div>
      <div>{children}</div>
    </Card>
  );
}

function useForm() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const run = async (e: FormEvent, task: () => Promise<string>) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ kind: 'success', text: await task() });
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, run };
}

function ProfileForm() {
  const { user, setUser } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const f = useForm();
  return (
    <form className="space-y-4" onSubmit={(e) => f.run(e, async () => {
      setUser((await api<{ user: User }>('/api/me/profile', { body: { name } })).user);
      return 'Đã lưu.';
    })}>
      {f.msg && <Alert kind={f.msg.kind}>{f.msg.text}</Alert>}
      <Field label="Tên hiển thị" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="Email" value={user?.email ?? ''} disabled hint={user?.emailVerified ? 'Đã xác minh.' : 'Chưa xác minh.'} />
      <Button variant="primary" busy={f.busy} type="submit">Lưu</Button>
    </form>
  );
}

function PasswordForm() {
  const { user, setUser } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const f = useForm();
  return (
    <form className="space-y-4" onSubmit={(e) => f.run(e, async () => {
      setUser((await api<{ user: User }>('/api/me/password', { body: { currentPassword: current, newPassword: next } })).user);
      setCurrent('');
      setNext('');
      return 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.';
    })}>
      {f.msg && <Alert kind={f.msg.kind}>{f.msg.text}</Alert>}
      {user?.hasPassword && <Field label="Mật khẩu hiện tại" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      <Field label={user?.hasPassword ? 'Mật khẩu mới' : 'Đặt mật khẩu'} type="password" autoComplete="new-password" required minLength={8} hint="Ít nhất 8 ký tự." value={next} onChange={(e) => setNext(e.target.value)} />
      <Button variant="primary" busy={f.busy} type="submit">{user?.hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}</Button>
    </form>
  );
}

function DeleteAccount() {
  const { user, setUser } = useSession();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const f = useForm();
  if (!open) return <Button variant="danger" onClick={() => setOpen(true)}>Xoá tài khoản…</Button>;
  return (
    <form className="space-y-4" onSubmit={(e) => f.run(e, async () => {
      await api('/api/me/delete', { body: { confirmEmail: confirm } });
      setUser(null);
      navigate('/login', { replace: true });
      return '';
    })}>
      <Alert kind="error">Tài khoản và mọi dữ liệu của bạn sẽ bị xoá vĩnh viễn, không khôi phục được.</Alert>
      {f.msg?.kind === 'error' && <Alert kind="error">{f.msg.text}</Alert>}
      <Field label={`Gõ email ${user?.email} để xác nhận`} type="email" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" busy={f.busy} type="submit" disabled={confirm.trim().toLowerCase() !== user?.email}>Xoá vĩnh viễn</Button>
        <Button type="button" onClick={() => { setOpen(false); setConfirm(''); }}>Huỷ</Button>
      </div>
    </form>
  );
}

export function Account() {
  const { user } = useSession();
  return (
    <AppLayout>
      <h1 className="text-2xl font-bold tracking-tight">Tài khoản</h1>
      <div className="mt-6 space-y-4">
        <Section title="Thông tin" text="Tên hiển thị trong ứng dụng."><ProfileForm /></Section>
        <Section title="Mật khẩu" text={user?.googleLinked ? 'Bạn đăng nhập được bằng Google. Có thể đặt thêm mật khẩu.' : undefined}><PasswordForm /></Section>
        <Section title="Dữ liệu của bạn" text="Tải về một bản sao dữ liệu chúng tôi lưu về bạn.">
          <a href="/api/me/export" className="inline-flex rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-brand">Tải dữ liệu (JSON)</a>
        </Section>
        <Section title="Xoá tài khoản" text="Xoá vĩnh viễn tài khoản và mọi dữ liệu."><DeleteAccount /></Section>
      </div>
    </AppLayout>
  );
}
