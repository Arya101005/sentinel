import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/primitives';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Error 404</p>
      <h1 className="text-2xl font-semibold text-navy-900">Page not found</h1>
      <p className="max-w-md text-sm leading-relaxed text-slate-600">
        The page you requested does not exist, or you followed an outdated link.
      </p>
      <Link to="/">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
