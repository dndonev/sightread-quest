import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useStore } from '../state/store';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'secondary', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-2xl px-4 min-h-12 font-semibold transition active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none';
  const v: Record<Variant, string> = {
    primary: 'bg-gradient-to-r from-accent to-accent-2 text-slate-950 shadow-lg shadow-accent/20',
    secondary: 'bg-panel-2 text-ink border border-line hover:border-accent/50',
    ghost: 'text-muted hover:text-ink',
    danger: 'bg-bad/15 text-bad border border-bad/40',
  };
  return (
    <button className={cx(base, v[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('rounded-3xl border border-line bg-panel/80 p-4 text-left backdrop-blur', onClick && 'w-full transition hover:border-accent/50 active:scale-[0.99]', className)}>
      {children}
    </Tag>
  );
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const color = { accent: 'from-accent to-accent-2', good: 'from-good to-accent', warn: 'from-warn to-warn', bad: 'from-bad to-bad' }[tone];
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-line', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full bg-gradient-to-r transition-[width] duration-500', color)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-xs font-medium text-muted', className)}>{children}</span>;
}

export function Segmented<T extends string | number>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('flex flex-wrap gap-1 rounded-2xl border border-line bg-panel-2 p-1', className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold transition', o.value === value ? 'bg-accent/15 text-accent ring-1 ring-accent/40' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-1">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-8 w-14 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}
      >
        <span className={cx('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all', checked ? 'left-7' : 'left-1')} />
      </button>
    </label>
  );
}

export function Header({ title, subtitle, right, onBack }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; onBack?: () => void }) {
  const back = useStore((s) => s.back);
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2 border-b border-line/60 bg-bg/85 px-4 pb-2 backdrop-blur" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
      <button aria-label="Back" onClick={onBack ?? back} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-ink">
        <ChevronLeft size={26} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel-2/70 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
      <div className="tabular text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-faint">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular text-accent">{format ? format(value) : value}</span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
}

export function formatMs(ms: number): string {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
