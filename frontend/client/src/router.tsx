// A tiny router for /app/*: enough for a handful of pages, no dependency.
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // "/app"

/** The path inside the app, e.g. "/login" for /app/login. */
function currentPath() {
  const p = window.location.pathname.startsWith(BASE) ? window.location.pathname.slice(BASE.length) : window.location.pathname;
  return p || '/';
}

export function navigate(to: string, { replace = false } = {}) {
  const url = BASE + to;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useRoute() {
  const [path, setPath] = useState(currentPath);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search));
  useEffect(() => {
    const onPop = () => {
      setPath(currentPath());
      setSearch(new URLSearchParams(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return { path, search };
}

/** A link inside the app: no full page load. */
export function Link({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={BASE + to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...props}
    />
  );
}
