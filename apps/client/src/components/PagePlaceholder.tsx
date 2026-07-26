interface PagePlaceholderProps {
  title: string;
  phase: string;
  children: React.ReactNode;
}

/** Temporary. Each of these is replaced by the phase named on it. */
export function PagePlaceholder({ title, phase, children }: PagePlaceholderProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-8">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-prose text-sm text-slate-600">{children}</p>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">{phase}</p>
    </section>
  );
}
