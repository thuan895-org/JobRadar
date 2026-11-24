// Form controls for longer forms (profile, onboarding).
import { useId, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';

/** Pick one (or several, with `multiple`) of a few options, shown as pill buttons. */
export function Pills<T extends string>({ options, value, onChange, multiple = false, label }: {
  options: { value: T; label: string }[];
  value: T | T[] | null;
  onChange: (v: any) => void;
  multiple?: boolean;
  label?: string;
}) {
  const selected = (v: T) => (multiple ? (value as T[] ?? []).includes(v) : value === v);
  const toggle = (v: T) => {
    if (!multiple) return onChange(v);
    const list = (value as T[]) ?? [];
    onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={selected(o.value)} onClick={() => toggle(o.value)}
          className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${selected(o.value)
            ? 'border-brand bg-brand text-on-brand'
            : 'border-line bg-surface text-text hover:border-brand'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Free-form keywords: type and press Enter or comma; click × to drop one. */
export function TagInput({ value, onChange, placeholder, label, hint }: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  label: string;
  hint?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const terms = raw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t && t.length <= 60 && !value.includes(t));
    if (terms.length) onChange([...value, ...terms]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/20">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-1 text-sm text-brand">
            {t}
            <button type="button" aria-label={`Bỏ ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="text-brand/70 hover:text-brand">×</button>
          </span>
        ))}
        <input id={id} value={draft} placeholder={value.length ? '' : placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
          onBlur={() => draft && add(draft)} className="min-w-32 flex-1 bg-transparent px-1 py-1 text-[15px] outline-none placeholder:text-muted/70" />
      </div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function TextArea({ label, hint, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <textarea id={id} rows={4}
        className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20"
        {...props} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-line transition peer-checked:bg-brand peer-focus-visible:ring-3 peer-focus-visible:ring-brand/30" />
        <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
