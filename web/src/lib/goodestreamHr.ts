/**
 * Frontend client for GoodeStream HR Assist (/api/goodestream-hr).
 * Mirrors the talkDangerously client shape.
 */

export type Passage = { id: string; title: string; text: string };

export type HrReply = {
  grounded: boolean;
  escalate: boolean;
  citedPassageId: string | null;
  answer: string;
  callsRemaining: number;
  dailyLimit: number;
  model: string;
  attribution: string;
};

export type HrError = { error: string; callsRemaining?: number; dailyLimit?: number };

export type HrStatus = { callsRemaining: number; dailyLimit: number; model: string; attribution: string };

export async function fetchHrStatus(): Promise<HrStatus> {
  const resp = await fetch('/api/goodestream-hr-status', { method: 'GET' });
  if (!resp.ok) throw new Error(`Status returned ${resp.status}`);
  return resp.json();
}

export async function askHr(question: string, passages: Passage[]): Promise<HrReply | HrError> {
  const resp = await fetch('/api/goodestream-hr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, passages }),
  });
  // Backend always returns JSON (incl. 5xx with a friendly `error` + spent
  // `callsRemaining`); surface that rather than throwing a status-code string.
  const body = (await resp.json().catch(() => ({ error: `HR endpoint returned ${resp.status}` }))) as
    | HrReply
    | HrError;
  return body;
}

export function isHrReply(r: HrReply | HrError): r is HrReply {
  return (r as HrReply).answer !== undefined && (r as HrError).error === undefined;
}
