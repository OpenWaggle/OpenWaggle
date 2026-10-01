import type { SessionTitleContextMessage } from '../src/main/domain/session-title/session-title-context'

function message(role: 'user' | 'assistant', text: string): SessionTitleContextMessage {
  return { role, text, attachments: [] }
}

/**
 * Title scenarios for `pnpm evaluate:session-titles`. Adapted from T3 Code
 * (`apps/server/scripts/threadTitleEvaluationCases.ts`, MIT License, Copyright (c) 2026 T3 Tools
 * Inc.) per ADR 0043; repeated text adds context pressure.
 */
export const SESSION_TITLE_EVALUATION_CASES = [
  {
    id: 'first-prompt-copy',
    request: 'Replace first-prompt titles with short generated ones that help find a session.',
    previousTitle: 'the session title is getting from the first prompt and I...',
    messages: [
      message(
        'user',
        'the session title is getting from the first prompt and I would like to instead have a short title that describe what we are doing so the user is able to identify better which converstation belongs to which session',
      ),
    ],
    rubric: 'Name generated session titles. Do not copy or truncate the request.',
  },
  {
    id: 'vague-opening',
    request: 'A failing test is later identified as a lazy feed mismatch.',
    previousTitle: 'Fix failing test',
    messages: [
      message('user', 'Fix this failing test.'),
      message('assistant', 'The lazy feed test expects a full message body before the client requests it.'),
    ],
    rubric: 'Name the lazy feed test. Do not invent a wider regression.',
  },
  {
    id: 'scope-change',
    request: 'Change the goal from QR layout to pairing expiry, despite long assistant replies.',
    previousTitle: 'Improve QR layout',
    messages: [
      message('user', 'Improve QR sharing layout.'),
      message('user', 'Change of plan. Fix pairing token expiry. Keep remote access working.'),
      message('assistant', `The token expires before redemption. ${'Implementation detail. '.repeat(800)}`),
      message('user', 'Ship it.'),
    ],
    rubric: 'Name pairing expiry and honor the explicit scope change.',
  },
  {
    id: 'review-umbrella',
    request: 'Review subagent monitoring risks. A roster issue is one finding.',
    previousTitle: 'Review subagent monitoring risks',
    messages: [
      message('user', 'Review subagent monitoring risks.'),
      message('assistant', `One finding is a stale roster. ${'Roster detail. '.repeat(800)}`),
      message('user', 'Fix the findings and babysit CI.'),
    ],
    rubric: 'Preserve the monitoring review scope. The previous title can stay unchanged.',
  },
  {
    id: 'long-opening',
    request: 'Investigate Android pairing while preserving the iOS flow.',
    previousTitle: 'Inspect logs',
    messages: [
      message(
        'user',
        `Investigate Android pairing. ${'Connection logs. '.repeat(800)} Preserve the iOS pairing flow.`,
      ),
    ],
    rubric: 'Name Android pairing. Logs are supporting evidence.',
  },
  {
    id: 'worker-objective',
    request: 'A Worker spawned to review the auth module for token leaks.',
    previousTitle: 'You are a Worker. Review src/auth for token leaks and...',
    messages: [
      message(
        'user',
        'You are a Worker. Review src/auth for token leaks and report findings with file and line references. Do not edit files.',
      ),
    ],
    rubric: 'Name the auth token leak review. Leave out Worker and reporting instructions.',
  },
  {
    id: 'non-english',
    request: 'A Spanish request about sidebar search.',
    previousTitle: 'quiero que la búsqueda del sidebar encuentre...',
    messages: [
      message(
        'user',
        'quiero que la búsqueda del sidebar encuentre sesiones por el contenido de la conversación y no solo por el título',
      ),
    ],
    rubric: 'Write in Spanish. Name sidebar search by conversation content.',
  },
  {
    id: 'greeting',
    request: 'A conversational opener with no task.',
    previousTitle: 'hey',
    messages: [message('user', 'hey')],
    rubric: 'Return a short meaningful title instead of refusing or copying the greeting.',
  },
] satisfies ReadonlyArray<{
  readonly id: string
  readonly request: string
  readonly previousTitle: string
  readonly messages: readonly SessionTitleContextMessage[]
  readonly rubric: string
}>
