import { Clock3, Loader2, Send, XCircle } from 'lucide-react';

export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; icon: typeof Clock3 }> = {
    scheduled: { label: 'Scheduled', className: 'bg-blue-50 text-blue-700', icon: Clock3 },
    processing: { label: 'Sending', className: 'bg-indigo-50 text-indigo-700', icon: Loader2 },
    rate_limited: { label: 'Rate limited', className: 'bg-amber-50 text-amber-700', icon: Clock3 },
    sent: { label: 'Sent', className: 'bg-emerald-50 text-emerald-700', icon: Send },
    failed: { label: 'Failed', className: 'bg-rose-50 text-rose-700', icon: XCircle },
    cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-600', icon: XCircle },
  };
  const item = config[status] ?? config.scheduled;
  const Icon = item.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${item.className}`}>
      <Icon size={12} className={status === 'processing' ? 'animate-spin' : ''} />
      {item.label}
    </span>
  );
}
