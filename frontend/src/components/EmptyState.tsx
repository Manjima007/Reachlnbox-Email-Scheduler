import { Inbox } from 'lucide-react';

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Inbox size={22} />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function LoadingRows({ columns = 5 }: { columns?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-6 px-6 py-4">
          {Array.from({ length: columns }).map((_, index) => (
            <div key={index} className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ))}
    </div>
  );
}
