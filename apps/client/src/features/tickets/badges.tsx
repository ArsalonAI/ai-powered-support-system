const BASE = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-blue-50 text-blue-700',
  RESOLVED: 'bg-green-50 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${BASE} ${STATUS_STYLES[status] ?? STATUS_STYLES.CLOSED}`}>
      {status.toLowerCase()}
    </span>
  );
}

/**
 * The single most important triage signal — it is what separates "needs a
 * reply" from "ball is in their court". Without it every live ticket looks
 * identical in the list.
 */
export function WaitingOnBadge({ waitingOn }: { waitingOn: string }) {
  const us = waitingOn === 'US';
  return (
    <span
      className={`${BASE} ${us ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}
    >
      {us ? 'us' : 'customer'}
    </span>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  TECHNICAL_QUESTION: 'technical',
  REFUND_REQUEST: 'refund',
  GENERAL_QUESTION: 'general',
};

/**
 * A failed classification never gates the agent — the ticket stays fully
 * workable and simply shows a manual-triage badge.
 */
export function CategoryBadge({
  category,
  classificationState,
}: {
  category: string | null;
  classificationState: string;
}) {
  if (classificationState === 'FAILED') {
    return <span className={`${BASE} bg-red-50 text-red-700`}>needs triage</span>;
  }
  if (category === null) {
    return <span className={`${BASE} bg-slate-50 text-slate-400`}>unclassified</span>;
  }
  return (
    <span className={`${BASE} bg-slate-100 text-slate-700`}>
      {CATEGORY_LABELS[category] ?? category.toLowerCase()}
    </span>
  );
}
