/**
 * Frontend client for the talk-dangerously backend.
 * Mirrors the alphavantage client shape so /console can reuse the counter-widget pattern.
 */

export type TalkStatus = {
  callsRemaining: number;
  dailyLimit: number;
  model: string;
  attribution: string;
  attributionUrl: string;
};

export type TalkReply = {
  reply: string;
  callsRemaining: number;
  dailyLimit: number;
  model: string;
  attribution: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type TalkError = {
  error: string;
  callsRemaining?: number;
  dailyLimit?: number;
};

export async function fetchTalkStatus(): Promise<TalkStatus> {
  const resp = await fetch('/api/talk-dangerously-status', { method: 'GET' });
  if (!resp.ok) throw new Error(`Status returned ${resp.status}`);
  return resp.json();
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export async function postMessage(
  message: string,
  history: ChatTurn[] = [],
): Promise<TalkReply | TalkError> {
  const resp = await fetch('/api/talk-dangerously', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  const body = (await resp.json()) as TalkReply | TalkError;
  if (resp.status >= 500) {
    throw new Error(`Talk endpoint returned ${resp.status}: ${('error' in body && body.error) || 'unknown'}`);
  }
  return body;
}

export function isReply(r: TalkReply | TalkError): r is TalkReply {
  return (r as TalkReply).reply !== undefined;
}
