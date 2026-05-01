import { useEffect, useRef, useState } from 'react';

/**
 * "Contact me" modal — invoked from the IDE FileExplorer's email.txt row.
 *
 * V1 implementation: builds a `mailto:` URL with the visitor's typed email,
 * subject, and body, then opens it in their default mail client. No backend
 * required; the email is sent FROM the visitor TO me@necogoode.com when they
 * confirm in their mail client. This is the standard approach for personal
 * portfolio contact forms — reliable, no infra, no API keys to rotate.
 *
 * V2 candidate: route through Azure Communication Services Email so the
 * message can be delivered without leaving the browser. Add when sustained
 * traffic justifies the resource + verified-domain overhead.
 */

const CONTACT_EMAIL = 'me@necogoode.com';

export function ContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('Hello from necogoode.com');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // ESC closes; click-outside closes; focus first field on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validBody = body.trim().length >= 5;
  const canSend = validEmail && validBody;

  const handleSend = () => {
    setTouched(true);
    if (!canSend) return;

    // Construct mailto with prefilled subject + body (visitor's email is the From)
    // We embed their email in the body too, in case they send from a different address
    // than the one they typed (e.g., they have multiple inboxes).
    const fullBody =
      `${body.trim()}\n\n---\nFrom: ${email}\n(Submitted via necogoode.com contact modal)`;
    const url = `mailto:${CONTACT_EMAIL}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(fullBody)}`;
    window.location.href = url;
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal — IDE-styled to match its caller (FileExplorer in TechTour) */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-md bg-[var(--tech-bg-soft)] border border-[var(--tech-line)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Titlebar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--tech-bg-line)] border-b border-[var(--tech-line)]">
          <div className="w-3 h-3 rounded-full bg-[var(--tech-pink)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--tech-yellow)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--tech-green)]" />
          <span id="contact-modal-title" className="flex-1 text-center font-mono text-[0.7rem] text-[var(--tech-text-faint)]">
            email.txt — contact neco
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--tech-text-faint)] hover:text-[var(--tech-text)] font-mono text-base px-1"
          >
            ×
          </button>
        </div>

        <form
          className="p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <div className="font-mono text-[0.78rem] text-[var(--tech-text-soft)] leading-relaxed">
            <span className="text-[var(--tech-syn-comment)]">// drop a note. opens your mail client to send to</span>{' '}
            <span className="text-[var(--tech-syn-string)]">{CONTACT_EMAIL}</span>
          </div>

          <Field label="your email" hint={touched && !validEmail ? 'looks invalid' : null}>
            <input
              ref={firstFieldRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full bg-transparent border-b border-[var(--tech-line)] focus:border-[var(--tech-blue)] outline-none text-[var(--tech-text)] font-mono text-sm py-1.5 placeholder:text-[var(--tech-text-faint)]"
            />
          </Field>

          <Field label="subject">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-transparent border-b border-[var(--tech-line)] focus:border-[var(--tech-blue)] outline-none text-[var(--tech-text)] font-mono text-sm py-1.5"
            />
          </Field>

          <Field label="message" hint={touched && !validBody ? 'add a few words (5+ chars)' : null}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="hiring? partnering? saw a creation you liked? say what you'd want to talk about."
              className="w-full bg-transparent border border-[var(--tech-line)] focus-within:border-[var(--tech-blue)] outline-none text-[var(--tech-text)] font-mono text-sm py-2 px-3 resize-none placeholder:text-[var(--tech-text-faint)]"
            />
          </Field>

          <div className="flex justify-between items-center pt-2 border-t border-[var(--tech-line)]">
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[0.78rem] uppercase tracking-[0.12em] text-[var(--tech-text-soft)] hover:text-[var(--tech-text)]"
            >
              esc · cancel
            </button>
            <button
              type="submit"
              disabled={!canSend}
              className="font-mono text-[0.78rem] uppercase tracking-[0.12em] px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--tech-blue)] text-[var(--tech-bg-darker)] hover:bg-[var(--tech-syn-prop)]"
            >
              ▸ open mail client
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-[var(--tech-text-faint)] mb-1.5">
        {label} {hint && <span className="text-[var(--tech-pink)] normal-case tracking-normal ml-2">— {hint}</span>}
      </div>
      {children}
    </label>
  );
}
