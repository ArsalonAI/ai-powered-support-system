import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-8">
      <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        That page does not exist.{' '}
        <Link to="/tickets" className="font-medium text-slate-900 underline underline-offset-2">
          Back to tickets
        </Link>
      </p>
    </section>
  );
}
