import { parseDialogueReply, type DialogueReply, type DialogueRequest } from './dialogue-contract';

export type DialogueTransport = (request: DialogueRequest, signal: AbortSignal) => Promise<DialogueReply>;
export class DialogueError extends Error {
  constructor(readonly retryAfter = 15) { super('dialogue-unavailable'); }
}
export const requestDialogue: DialogueTransport = async (request, signal) => {
  const response = await fetch('/api/companion', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify(request), signal,
  });
  if (!response.ok) throw new DialogueError(Math.min(3600, Math.max(15, Number(response.headers.get('retry-after')) || 15)));
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 3
    || !('requestId' in raw) || raw.requestId !== request.requestId || !('reply' in raw) || !('tactic' in raw)) throw new DialogueError();
  const reply = parseDialogueReply({ reply: raw.reply, tactic: raw.tactic });
  if (!reply) throw new DialogueError();
  return reply;
};
