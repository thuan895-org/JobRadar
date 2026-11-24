import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig() {
  return JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
}

/** Reads KEY=VALUE lines from .env into process.env (without overriding). */
export function loadEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const UA = 'JobRadar/1.0 (personal job alerts; links back to every source)';

export async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return res.json();
}

export async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return res.text();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Job descriptions arrive as HTML from third parties: keep text only. */
export function htmlToText(html) {
  const withBreaks = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withBreaks)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function toIso(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function money(min, max, unit = '') {
  const f = (n) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
  if (!min && !max) return '';
  if (min && max && min !== max) return `${f(min)}–${f(max)}${unit}`;
  return `${f(max || min)}${unit}`;
}
