/**
 * Frontend client for GoodeStream Document Insight (/api/goodestream-document).
 */

export type Finding = {
  severity: 'high' | 'medium' | 'low';
  label: string;
  excerpt: string;
  issue: string;
  suggestion: string;
};

export type DocReport = {
  summary: string;
  findings: Finding[];
  truncated: boolean;
  purpose: string;
  purposeLabel: string;
  callsRemaining: number;
  dailyLimit: number;
  model: string;
  attribution: string;
};

export type DocError = { error: string; callsRemaining?: number; dailyLimit?: number };

export type DocStatus = { callsRemaining: number; dailyLimit: number; model: string; attribution: string };

export async function fetchDocStatus(): Promise<DocStatus> {
  const resp = await fetch('/api/goodestream-document-status', { method: 'GET' });
  if (!resp.ok) throw new Error(`Status returned ${resp.status}`);
  return resp.json();
}

export async function analyzeDocument(text: string, purpose: string): Promise<DocReport | DocError> {
  const resp = await fetch('/api/goodestream-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, purpose }),
  });
  // Backend always returns JSON (incl. 5xx with a friendly `error` + spent
  // `callsRemaining`); surface that rather than throwing a status-code string.
  const body = (await resp.json().catch(() => ({ error: `Document endpoint returned ${resp.status}` }))) as
    | DocReport
    | DocError;
  return body;
}

export function isDocReport(r: DocReport | DocError): r is DocReport {
  return (r as DocReport).findings !== undefined && (r as DocError).error === undefined;
}
