/** Talking to the JobRadar server from either app. Cookies carry the login. */

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  needsConsent: boolean;
  plan: 'trial' | 'pro' | 'free';
  proFeatures: boolean;
  trialEndsAt: string | null;
  proUntil: string | null;
  telegramLinked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export type PublicConfig = {
  googleEnabled: boolean;
  emailEnabled: boolean;
  termsVersion: string;
  operatorName: string;
  contactEmail: string;
  priceVnd: number;
  billingMode: string;
  telegramChannel: string;
  adsenseClient: string;
  adsenseFeedSlot: string;
};

/** Days left until an ISO date, at least 0. */
export const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 864e5)) : 0);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** JSON in, JSON out. Throws ApiError with the server's (Vietnamese) message. */
export async function api<T>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(options.timeoutMs ?? 90000),
    });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') throw new ApiError(0, 'Server phản hồi quá chậm. Thử lại sau ít phút (máy chủ có thể đang khởi động).');
    throw new ApiError(0, 'Không kết nối được server. Kiểm tra mạng rồi thử lại.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Lỗi ${res.status}`);
  return data as T;
}

export async function serverHealthy(): Promise<boolean> {
  try {
    const res = await fetch('/healthz');
    return res.ok;
  } catch {
    return false;
  }
}
