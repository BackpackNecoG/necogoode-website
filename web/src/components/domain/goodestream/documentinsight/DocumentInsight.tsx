import { useEffect, useRef, useState } from 'react';
import { PURPOSES, getPurpose } from './samples';
import { extractText } from './extractText';
import { analyzeDocument, fetchDocStatus, isDocReport, DocReport, Finding } from '../../../../lib/goodestreamDoc';

/**
 * DocumentInsight — upload a document, pick a purpose, get a structured report.
 *
 * One engine, a rubric per purpose. Files are parsed in the browser (txt/md/pdf/
 * docx); only the extracted text is sent to the Azure Function. Bundled sample
 * documents let a visitor try it with zero upload. Assists, doesn't decide.
 */

const SEVERITY_STYLE: Record<Finding['severity'], { color: string; label: string }> = {
  high: { color: 'var(--splash-bus)', label: 'High' },
  medium: { color: 'var(--splash-tech)', label: 'Medium' },
  low: { color: 'var(--splash-text-soft)', label: 'Low' },
};

export function DocumentInsight() {
  const [purpose, setPurpose] = useState(PURPOSES[0].value);
  const [text, setText] = useState('');
  const [docLabel, setDocLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseMsg, setParseMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DocReport | null>(null);
  const [calls, setCalls] = useState<{ remaining: number; limit: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDocStatus()
      .then((s) => !cancelled && setCalls({ remaining: s.callsRemaining, limit: s.dailyLimit }))
      .catch(() => !cancelled && setCalls(null));
    return () => {
      cancelled = true;
    };
  }, []);

  function loadSample() {
    const p = getPurpose(purpose);
    if (!p) return;
    setText(p.sample);
    setDocLabel(`${p.sampleName} (sample)`);
    setReport(null);
    setError(null);
    setParseMsg(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setParseMsg('Reading file in your browser…');
    setError(null);
    setReport(null);
    const result = await extractText(file);
    setBusy(false);
    if (result.ok) {
      setText(result.text);
      setDocLabel(file.name);
      setParseMsg(`Extracted ${result.text.length.toLocaleString()} characters — nothing was uploaded to a server.`);
    } else {
      setParseMsg(null);
      setError(result.error);
    }
  }

  async function run() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const r = await analyzeDocument(text, purpose);
      if (isDocReport(r)) {
        setReport(r);
        setCalls({ remaining: r.callsRemaining, limit: r.dailyLimit });
      } else {
        setError(r.error);
        if (typeof r.callsRemaining === 'number') setCalls((c) => (c ? { ...c, remaining: r.callsRemaining! } : c));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  const exhausted = calls?.remaining === 0;

  return (
    <div className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-4 md:p-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="block flex-1 min-w-[200px]">
          <span className="block font-mono text-[0.6rem] tracking-[0.14em] uppercase text-[var(--splash-text-faint)] mb-1">
            Purpose
          </span>
          <select
            value={purpose}
            onChange={(e) => {
              setPurpose(e.target.value as typeof purpose);
              setReport(null);
            }}
            className="w-full bg-[var(--splash-bg)] border border-[var(--splash-line)] rounded-sm px-2.5 py-2 font-mono text-[0.78rem] text-[var(--splash-text)] outline-none focus:border-[var(--splash-tech)]"
          >
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={loadSample}
          className="font-mono text-[0.68rem] tracking-[0.1em] uppercase px-3 py-2 rounded-sm border transition-colors hover:bg-[var(--splash-bg)]"
          style={{ borderColor: 'var(--splash-line)', color: 'var(--splash-text-soft)' }}
        >
          Load sample
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="font-mono text-[0.68rem] tracking-[0.1em] uppercase px-3 py-2 rounded-sm border transition-colors hover:bg-[var(--splash-bg)]"
          style={{ borderColor: 'var(--splash-line)', color: 'var(--splash-text-soft)' }}
        >
          Upload file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.pdf,.docx,text/plain,application/pdf"
          onChange={handleFile}
          className="sr-only"
          aria-label="Upload a document to analyze"
        />
      </div>

      {/* No-confidential-data warning */}
      <p className="font-mono text-[0.64rem] leading-relaxed text-[var(--splash-text-faint)] mb-3">
        Prototype — do not upload confidential or real personal data. Use the provided samples. Files
        are parsed in your browser; only the extracted text is sent to the model, and nothing is stored.
      </p>

      {/* Document text */}
      <label htmlFor="doc-text" className="block mb-1 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-[var(--splash-text-faint)]">
        Document text {docLabel && <span className="text-[var(--splash-tech)] normal-case tracking-normal">· {docLabel}</span>}
      </label>
      <textarea
        id="doc-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDocLabel(null);
        }}
        rows={8}
        placeholder="Paste text here, click “Load sample”, or upload a .txt / .md / .pdf / .docx file…"
        className="w-full bg-[var(--splash-bg)] border border-[var(--splash-line)] rounded-sm px-3 py-2.5 font-sans text-[0.85rem] leading-relaxed text-[var(--splash-text)] placeholder:text-[var(--splash-text-faint)] outline-none focus:border-[var(--splash-tech)] resize-y"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <div role="status" aria-live="polite" className="font-mono text-[0.64rem] text-[var(--splash-text-faint)]">
          {busy ? 'Analyzing in the browser-to-backend pipeline…' : parseMsg}
          {calls && (
            <span className="ml-2">
              · {calls.remaining}/{calls.limit} analyses left today
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy || !text.trim() || exhausted}
          className="font-mono text-[0.72rem] tracking-[0.12em] uppercase px-4 py-2 rounded-sm border transition-colors disabled:opacity-50"
          style={{ borderColor: 'var(--splash-tech)', color: 'var(--splash-tech)' }}
        >
          {busy ? 'Analyzing…' : exhausted ? 'Daily limit reached' : 'Analyze document →'}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-3 border rounded-sm p-3 font-sans text-[0.85rem] text-[var(--splash-text-soft)]" style={{ borderColor: 'var(--splash-bus)', background: 'rgba(251,191,119,0.06)' }}>
          {error}
        </div>
      )}

      <div aria-live="polite">{report && <Report report={report} />}</div>
    </div>
  );
}

function Report({ report }: { report: DocReport }) {
  return (
    <div className="mt-5 pt-5 border-t border-[var(--splash-line)]">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-[0.66rem] tracking-[0.14em] uppercase text-[var(--splash-text-faint)]">
          Report · {report.purposeLabel}
        </span>
      </div>
      <p className="font-serif text-[1.05rem] leading-relaxed text-[var(--splash-text)] mb-4">{report.summary}</p>

      {report.findings.length === 0 ? (
        <p className="font-sans text-[0.9rem] text-[var(--splash-text-soft)]">
          No significant issues flagged against this rubric. (A human should still review.)
        </p>
      ) : (
        <ol className="space-y-3 list-none">
          {report.findings.map((f, i) => {
            const s = SEVERITY_STYLE[f.severity];
            return (
              <li key={i} className="border border-[var(--splash-line)] bg-[var(--splash-bg)] rounded-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="font-mono text-[0.6rem] tracking-[0.12em] uppercase px-2 py-0.5 rounded-full"
                    style={{ border: `1px solid ${s.color}`, color: s.color }}
                  >
                    {s.label}
                  </span>
                  <span className="font-sans text-[0.95rem] font-semibold text-[var(--splash-text)]">{f.label}</span>
                </div>
                {f.excerpt && (
                  <blockquote className="border-l-2 pl-3 my-2 font-serif italic text-[0.92rem] text-[var(--splash-text-soft)]" style={{ borderColor: s.color }}>
                    “{f.excerpt}”
                  </blockquote>
                )}
                <p className="font-sans text-[0.88rem] leading-relaxed text-[var(--splash-text-soft)] mb-2">{f.issue}</p>
                {f.suggestion && (
                  <div className="font-sans text-[0.88rem] leading-relaxed">
                    <span className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-[var(--splash-tech)]">Suggested rewrite</span>
                    <p className="mt-1 text-[var(--splash-text)] m-0">{f.suggestion}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {report.truncated && (
        <p className="mt-3 font-mono text-[0.62rem] text-[var(--splash-text-faint)]">
          Note: the document was long and was truncated before analysis.
        </p>
      )}
      <p className="mt-4 font-mono text-[0.62rem] text-[var(--splash-text-faint)]">
        Assists, doesn’t decide — every finding is a suggestion for a human to weigh. · {report.attribution}
      </p>
    </div>
  );
}
