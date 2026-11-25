import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Bold,
  Calendar,
  Code,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Send,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { AppConfig, Sender } from '../types';
import { Button } from './Button';
import { extractEmails } from '../utils/emails';

interface Props {
  config: AppConfig;
  senders: Sender[];
  onBack: () => void;
  onScheduled: () => void;
  notify: (message: string, kind: 'success' | 'error' | 'info') => void;
}

// Quick-pick recipient presets — clicking adds the recipient AND pre-fills
// subject + body (unless the user has already typed their own).
const QUICK_RECIPIENTS: { email: string; label: string; subject: string; body: string }[] = [
  {
    email: 'manjimadutta42@gmail.com',
    label: 'Manjima (you)',
    subject: 'Reminder from your dashboard',
    body: 'Hi Manjima,\n\nJust a note from the ReachInbox dashboard.\n\nThanks,\nYou',
  },
  {
    email: 'hermionewitch12@gmil.com',
    label: 'Hermione',
    subject: 'Welcome to the team, Hermione 👋',
    body: 'Hi Hermione,\n\nWelcome aboard! We are thrilled to have you on the team. Grab your laptop and VPN access from IT, join the #new-channel Slack workspace, and book 30 minutes with your onboarding buddy for a dashboard walk-through.\n\nExcited to build with you,\nThe ReachInbox team',
  },
  {
    email: 'kinjaldutta005@gmail.com',
    label: 'Kinjal',
    subject: 'Your weekly product update',
    body: 'Hi Kinjal,\n\nQuick roundup of what shipped this week:\n• Email scheduler: rate-limiting and delayed sends are live.\n• Slack alerts: hourly-cap notifications post to your channel automatically.\n• Search: falls back to PostgreSQL when the cluster is down.\n\nThanks,\nProduct',
  },
  {
    email: 'diptimayeepatra07@gmail.com',
    label: 'Dipti',
    subject: 'Invoice #1042 is ready for your review',
    body: 'Hi Dipti,\n\nInvoice #1042 for the October consulting engagement is ready.\n\nAmount: $1,250.00\nDue: within 15 days of issue date\nReference: RI-2026-1042\n\nLet me know if the line items differ from what we agreed.\n\nBest,\nBilling',
  },
];

function localDateTime(offsetMs: number) {
  const date = new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

export function Compose({ config, senders, onBack, onScheduled, notify }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fromEmail, setFromEmail] = useState('manjimadutta42@gmail.com');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipInput, setRecipInput] = useState('');
  const [startTime, setStartTime] = useState('');
  const [delayMs, setDelayMs] = useState(config.minDelayMs);
  const [hourlyLimit, setHourlyLimit] = useState(config.maxEmailsPerHour);
  const [sendNow, setSendNow] = useState(false);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Default the From address to the primary sender once senders are loaded.
  useEffect(() => {
    if (senders.length) {
      const primary = senders.find((s) => s.email === 'manjimadutta42@gmail.com');
      setFromEmail(primary?.email ?? senders[0].email);
    }
  }, [senders]);

  // ---- Recipient handling ---------------------------------------------------
  function addRecipient(raw: string) {
    const parsed = extractEmails(raw);
    setRecipients((prev) => {
      const additions = parsed.filter((p) => !prev.includes(p));
      return [...prev, ...additions];
    });
    // Pre-fill subject/body for any quick-pick that got added.
    parsed.forEach((email) => {
      const preset = QUICK_RECIPIENTS.find((p) => p.email === email);
      if (preset) {
        setSubject((cur) => (cur.trim() ? cur : preset.subject));
        setBody((cur) => (cur.trim() ? cur : preset.body));
      }
    });
  }

  function onRecipKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      if (recipInput.trim()) addRecipient(recipInput);
      setRecipInput('');
    }
  }

  function toggleQuickRecipient(email: string) {
    setRecipients((prev) => {
      const wasSelected = prev.includes(email);
      if (wasSelected) return prev.filter((r) => r !== email);
      const preset = QUICK_RECIPIENTS.find((p) => p.email === email);
      if (preset) {
        setSubject((cur) => (cur.trim() ? cur : preset.subject));
        setBody((cur) => (cur.trim() ? cur : preset.body));
      }
      return [...prev, email];
    });
  }

  function removeRecipient(email: string) {
    setRecipients((prev) => prev.filter((r) => r !== email));
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    addRecipient(text);
  }

  // ---- Submit ----------------------------------------------------------------
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(fromEmail)) {
      notify('Enter a valid sender email address', 'error');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      notify('Subject and body are required', 'error');
      return;
    }
    if (recipients.length === 0) {
      notify('Add at least one recipient', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.schedule(
        {
          subject: subject.trim(),
          body: body.trim(),
          fromEmail,
          // "Send now" fires immediately; otherwise use the chosen start time.
          startTime: sendNow ? new Date().toISOString() : new Date(startTime || localDateTime(0)).toISOString(),
          delayMs: sendNow ? 0 : delayMs,
          hourlyLimit,
          recipients,
        },
        crypto.randomUUID(),
      );
      notify(
        sendNow
          ? `${result.total} email${result.total === 1 ? '' : 's'} queued to send now`
          : `${result.total} email${result.total === 1 ? '' : 's'} scheduled successfully`,
        'success',
      );
      onScheduled();
      onBack();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not schedule emails', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const visibleChips = recipients.slice(0, 4);
  const overflow = recipients.length - visibleChips.length;

  // ---- Formatting toolbar (cosmetic, inserts markers into the plain-text body)
  function insertWrap(before: string, after = before) {
    setBody((cur) => `${before}${cur}${after}`);
  }
  function insertLine(text: string) {
    setBody((cur) => (cur ? `${cur}\n${text}` : text));
  }

  const toolbar: { icon: React.ReactNode; title: string; action: () => void }[] = [
    { icon: <Undo2 size={14} />, title: 'Undo', action: () => insertLine('') },
    { icon: <Redo2 size={14} />, title: 'Redo', action: () => {} },
    { icon: <Type size={14} />, title: 'Font', action: () => {} },
    { icon: <Heading2 size={14} />, title: 'Heading', action: () => insertWrap('') },
    { icon: <Bold size={14} />, title: 'Bold', action: () => insertWrap('**') },
    { icon: <Italic size={14} />, title: 'Italic', action: () => insertWrap('*') },
    { icon: <Underline size={14} />, title: 'Underline', action: () => insertWrap('__') },
    { icon: <List size={14} />, title: 'Bulleted list', action: () => insertLine('• ') },
    { icon: <ListOrdered size={14} />, title: 'Numbered list', action: () => insertLine('1. ') },
    { icon: <Quote size={14} />, title: 'Quote', action: () => insertLine('> ') },
    { icon: <Code size={14} />, title: 'Code', action: () => insertWrap('`') },
    { icon: <Strikethrough size={14} />, title: 'Strikethrough', action: () => insertLine('~~') },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-brand-700">
            <ArrowLeft size={18} /> Compose New Email
          </button>
          <div className="flex items-center gap-2">
            <button
              title="Edit body"
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <Send size={16} className="rotate-45" />
            </button>
            <button
              onClick={() => setSendLaterOpen((o) => !o)}
              title="Send later"
              className={`rounded-full p-2 transition ${
                sendLaterOpen ? 'bg-brand-100 text-brand-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
              }`}
            >
              <Calendar size={16} />
            </button>
            <Button type="button" loading={submitting} icon={<Send size={15} />} onClick={() => formRef.current?.requestSubmit()}>
              {sendNow ? 'Send Now' : 'Send'}
            </Button>
          </div>
        </div>

        {/* Send Later panel */}
        {sendLaterOpen && (
          <div className="card animate-fadeUp mb-5 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Send Later</h3>
              <button
                onClick={() => {
                  setSendNow(false);
                  setSendLaterOpen(false);
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="start">Pick a date & time</label>
                <input
                  id="start"
                  type="datetime-local"
                  className="input"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Quick presets</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSendNow(true)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      sendNow ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Send now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSendNow(false);
                      setStartTime(localDateTime(86_400_000));
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Tomorrow, 10:00 AM
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="card p-6">
            {/* From */}
            <div className="mb-5 flex items-center gap-3">
              <span className="w-16 text-xs font-semibold text-slate-500">From</span>
              <select className="input max-w-xs" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)}>
                {senders.length === 0 && <option value={fromEmail}>{fromEmail}</option>}
                {senders.map((s) => (
                  <option key={s.id} value={s.email}>
                    {s.email}
                  </option>
                ))}
                {!senders.some((s) => s.email === fromEmail) && <option value={fromEmail}>{fromEmail}</option>}
              </select>
            </div>

            {/* To */}
            <div className="mb-5 flex items-center gap-3">
              <span className="w-16 text-xs font-semibold text-slate-500">To</span>
              <div className="flex flex-1 flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2">
                {visibleChips.map((chip) => (
                  <span key={chip} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-200">
                    {chip}
                    <button type="button" onClick={() => removeRecipient(chip)} className="text-brand-500 hover:text-brand-700">
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                    +{overflow}
                  </span>
                )}
                <input
                  className="min-w-[160px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                  value={recipInput}
                  onChange={(e) => setRecipInput(e.target.value)}
                  onKeyDown={onRecipKeyDown}
                  placeholder="recipient@example.com"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  <Upload size={13} /> Upload List
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
              </div>
            </div>

            {/* Quick-pick */}
            {recipients.length === 0 && (
              <div className="mb-5 -mt-1 flex flex-wrap gap-2 pl-[100px]">
                {QUICK_RECIPIENTS.map((p) => (
                  <button
                    key={p.email}
                    type="button"
                    onClick={() => toggleQuickRecipient(p.email)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                  >
                    <span className="font-semibold text-brand-600">{p.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Subject */}
            <div className="mb-5 flex items-center gap-3">
              <span className="w-16 text-xs font-semibold text-slate-500">Subject</span>
              <input
                className="input flex-1 border-0 bg-transparent px-0 focus:border-transparent focus:ring-0"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
              />
            </div>

            {/* Throttle controls */}
            <div className="mb-5 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500">Delay between 2 emails</label>
                <input
                  type="number"
                  min={0}
                  className="input !w-24"
                  value={delayMs}
                  onChange={(e) => setDelayMs(Number(e.target.value))}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500">Hourly Limit</label>
                <input
                  type="number"
                  min={1}
                  max={config.maxEmailsPerHour}
                  className="input !w-24"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Body editor */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-500">Type your reply</label>
              <div className="rounded-xl border border-slate-200 bg-slate-50/50">
                <textarea
                  className="min-h-[220px] w-full resize-y bg-transparent p-4 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Type your Reply..."
                />
                <div className="flex flex-wrap items-center gap-1 border-t border-slate-200 px-3 py-2">
                  {toolbar.map((tool, i) => (
                    <button
                      key={i}
                      type="button"
                      title={tool.title}
                      onClick={tool.action}
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-600"
                    >
                      {tool.icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-400">
              Effective spacing is at least {config.minDelayMs} ms. The hourly cap is {config.maxEmailsPerHour} emails
              ({config.rateLimitScope === 'sender' ? 'per sender' : 'globally'}). Jobs that exceed it are moved to the next window.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
