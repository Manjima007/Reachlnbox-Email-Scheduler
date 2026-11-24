import { ExternalLink, Trash2 } from 'lucide-react';
import type { Email } from '../types';
import { EmptyState, LoadingRows } from './EmptyState';
import { StatusBadge } from './StatusBadge';
import { Button } from './Button';

interface Props {
  emails: Email[];
  mode: 'scheduled' | 'sent' | 'failed';
  loading: boolean;
  onCancel?: (id: string) => void;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EmailTable({ emails, mode, loading, onCancel }: Props) {
  if (loading) return <LoadingRows />;
  if (emails.length === 0) {
    return (
      <EmptyState
        title={mode === 'scheduled' ? 'No scheduled emails' : mode === 'sent' ? 'No sent emails yet' : 'No failed emails'}
        description={
          mode === 'scheduled'
            ? 'Use “Compose new email” to upload leads and schedule your first sequence.'
            : 'Emails will appear here once the scheduler sends them through Ethereal SMTP.'
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-6 py-3 font-semibold">Email</th>
            <th className="px-6 py-3 font-semibold">Subject</th>
            <th className="px-6 py-3 font-semibold">{mode === 'sent' ? 'Sent time' : 'Scheduled time'}</th>
            <th className="px-6 py-3 font-semibold">Status</th>
            <th className="px-6 py-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {emails.map((email) => (
            <tr key={email.id} className="transition hover:bg-slate-50/70">
              <td className="px-6 py-4">
                <div className="font-medium text-slate-900">{email.toEmail}</div>
                <div className="text-xs text-slate-400">from {email.fromEmail}</div>
              </td>
              <td className="max-w-xs px-6 py-4">
                <div className="truncate font-medium text-slate-700">{email.subject}</div>
                {email.error && <div className="truncate text-xs text-rose-500" title={email.error}>{email.error}</div>}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                {formatDate(mode === 'sent' ? email.sentAt : email.sendAt)}
                {email.rateLimitHits > 0 && (
                  <div className="text-xs text-amber-600">rescheduled ×{email.rateLimitHits}</div>
                )}
              </td>
              <td className="px-6 py-4"><StatusBadge status={email.status} /></td>
              <td className="px-6 py-4 text-right">
                {mode === 'sent' && email.previewUrl ? (
                  <a href={email.previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
                    Preview <ExternalLink size={13} />
                  </a>
                ) : mode === 'scheduled' && onCancel ? (
                  <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => onCancel(email.id)} className="!px-2 !py-1 text-xs">
                    Cancel
                  </Button>
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
