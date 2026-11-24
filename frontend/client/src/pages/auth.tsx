import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Field, GoogleIcon, api, type User } from '@jobradar/shared';
import { AuthLayout } from '../layouts';
import { Link, navigate, useRoute } from '../router';
import { useSession } from '../session';

const GOOGLE_ERRORS: Record<string, string> = {
  google: 'Đăng nhập Google không thành công. Vui lòng thử lại.',
  google_off: 'Đăng nhập Google chưa được bật.',
};

function GoogleButton({ label }: { label: string }) {
  const { config } = useSession();
  if (!config?.googleEnabled) return null;
  return (
    <>
      <a href="/api/auth/google/start"
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:border-brand">
        <GoogleIcon /> {label}
      </a>
      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> hoặc dùng email <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

/** Runs a form submit: busy state, error message, no double submit. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (e: FormEvent, task: () => Promise<void>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function Login() {
  const { setUser } = useSession();
  const { search } = useRoute();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  const urlError = GOOGLE_ERRORS[search.get('error') ?? ''];
  return (
    <AuthLayout title="Đăng nhập" subtitle={<>Chưa có tài khoản? <Link to="/signup" className="font-semibold text-brand hover:underline">Đăng ký miễn phí</Link></>}>
      <GoogleButton label="Tiếp tục với Google" />
      <form className="space-y-4" onSubmit={(e) => run(e, async () => {
        setUser((await api<{ user: User }>('/api/auth/login', { body: { email, password } })).user);
        navigate('/', { replace: true });
      })}>
        {(error || urlError) && <Alert kind="error">{error || urlError}</Alert>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Mật khẩu" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="text-right text-sm"><Link to="/forgot" className="text-brand hover:underline">Quên mật khẩu?</Link></div>
        <Button variant="primary" block busy={busy} type="submit">Đăng nhập</Button>
      </form>
    </AuthLayout>
  );
}

export function Signup() {
  const { setUser } = useSession();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [accept, setAccept] = useState(false);
  const { busy, error, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthLayout title="Tạo tài khoản" subtitle={<>Đã có tài khoản? <Link to="/login" className="font-semibold text-brand hover:underline">Đăng nhập</Link></>}>
      <GoogleButton label="Đăng ký với Google" />
      <form className="space-y-4" onSubmit={(e) => run(e, async () => {
        setUser((await api<{ user: User }>('/api/auth/signup', { body: { ...form, acceptTerms: accept } })).user);
        navigate('/', { replace: true });
      })}>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Tên của bạn" autoComplete="name" required maxLength={100} value={form.name} onChange={set('name')} />
        <Field label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <Field label="Mật khẩu" type="password" autoComplete="new-password" required minLength={8} hint="Ít nhất 8 ký tự." value={form.password} onChange={set('password')} />
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
          <span>Tôi đã đọc và đồng ý <Link to="/terms" className="text-brand underline">Điều khoản sử dụng</Link> và <Link to="/privacy" className="text-brand underline">Chính sách quyền riêng tư</Link>, gồm việc xử lý dữ liệu cá nhân của tôi như mô tả trong đó.</span>
        </label>
        <Button variant="primary" block busy={busy} type="submit" disabled={!accept}>Tạo tài khoản</Button>
      </form>
    </AuthLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useSubmit();
  return (
    <AuthLayout title="Quên mật khẩu" subtitle="Nhập email tài khoản, chúng tôi sẽ gửi liên kết để đặt mật khẩu mới.">
      {done ? (
        <div className="space-y-4">
          <Alert kind="success">Nếu email này có tài khoản, bạn sẽ nhận được liên kết trong vài phút. Nhớ kiểm tra cả mục Spam.</Alert>
          <Link to="/login" className="block text-center text-sm font-semibold text-brand hover:underline">Quay lại đăng nhập</Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => run(e, async () => {
          await api('/api/auth/forgot', { body: { email } });
          setDone(true);
        })}>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button variant="primary" block busy={busy} type="submit">Gửi liên kết</Button>
          <Link to="/login" className="block text-center text-sm text-muted hover:text-text">Quay lại đăng nhập</Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function Reset() {
  const { setUser } = useSession();
  const { search } = useRoute();
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <AuthLayout title="Đặt mật khẩu mới" subtitle="Sau khi đổi, các thiết bị khác sẽ bị đăng xuất.">
      <form className="space-y-4" onSubmit={(e) => run(e, async () => {
        setUser((await api<{ user: User }>('/api/auth/reset', { body: { token: search.get('token'), password } })).user);
        navigate('/', { replace: true });
      })}>
        {error && <Alert kind="error">{error} <Link to="/forgot" className="underline">Gửi lại liên kết</Link></Alert>}
        <Field label="Mật khẩu mới" type="password" autoComplete="new-password" required minLength={8} hint="Ít nhất 8 ký tự." value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button variant="primary" block busy={busy} type="submit">Lưu mật khẩu</Button>
      </form>
    </AuthLayout>
  );
}

export function Verify() {
  const { search } = useRoute();
  const { refresh, user } = useSession();
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  useEffect(() => {
    api('/api/auth/verify', { body: { token: search.get('token') } })
      .then(() => { setState('ok'); return refresh(); })
      .catch((err) => { setState('error'); setMessage(err.message); });
  }, [search, refresh]);
  return (
    <AuthLayout title="Xác minh email">
      {state === 'working' && <Alert>Đang xác minh…</Alert>}
      {state === 'ok' && <Alert kind="success">Email của bạn đã được xác minh. Cảm ơn bạn!</Alert>}
      {state === 'error' && <Alert kind="error">{message}</Alert>}
      {state !== 'working' && (
        <Link to={user ? '/' : '/login'} className="mt-6 block text-center text-sm font-semibold text-brand hover:underline">
          {user ? 'Vào JobRadar' : 'Đăng nhập'}
        </Link>
      )}
    </AuthLayout>
  );
}

/** Shown after Google sign-up, or when the terms change. Nothing else works until it is accepted. */
export function Consent() {
  const { setUser, logout } = useSession();
  const [accept, setAccept] = useState(false);
  const { busy, error, run } = useSubmit();
  return (
    <AuthLayout title="Một bước nữa" subtitle="Trước khi dùng JobRadar, vui lòng đọc và đồng ý với điều khoản của chúng tôi.">
      <form className="space-y-5" onSubmit={(e) => run(e, async () => {
        setUser((await api<{ user: User }>('/api/auth/consent', { body: { accept: true } })).user);
        navigate('/', { replace: true });
      })}>
        {error && <Alert kind="error">{error}</Alert>}
        <ul className="space-y-2 rounded-xl border border-line bg-bg p-4 text-sm text-muted">
          <li>• Chúng tôi dùng email và hồ sơ của bạn để lọc job và soạn hồ sơ ứng tuyển.</li>
          <li>• Hồ sơ chỉ được gửi cho AI khi bạn dùng tính năng AI.</li>
          <li>• Bạn có thể xuất hoặc xoá toàn bộ dữ liệu bất cứ lúc nào trong mục Tài khoản.</li>
        </ul>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
          <span>Tôi đã đọc và đồng ý <Link to="/terms" className="text-brand underline">Điều khoản sử dụng</Link> và <Link to="/privacy" className="text-brand underline">Chính sách quyền riêng tư</Link>.</span>
        </label>
        <Button variant="primary" block busy={busy} type="submit" disabled={!accept}>Đồng ý và tiếp tục</Button>
        <button type="button" onClick={async () => { await logout(); navigate('/login'); }} className="block w-full text-center text-sm text-muted hover:text-text">Không đồng ý, đăng xuất</button>
      </form>
    </AuthLayout>
  );
}
