import type { ModelScenario } from './website-screenshot-model-server'

/**
 * The conversations the scripted model plays in the essentials screenshots. Each opens with one
 * of these prompts; the Title model's answer and every later turn follow from it.
 */
export const APPROVAL_PROMPT =
  'The notes page shows an empty list since the last change. Open it in the browser preview and tell me what you see before changing anything.'
export const APPROVAL_TITLE = 'Check the empty notes page'

export const WORKING_PROMPT =
  'Add a CSV export to the notes list. Include the title, tags and last edited date for each note.'
export const WORKING_TITLE = 'Add CSV export to notes list'
export const WORKING_FOLLOW_UPS = [
  'Use the same date format as the notes list.',
  'Then add a test for notes without tags.',
] as const

export const ERROR_PROMPT = 'Update the lockfile after the dependency audit and run the tests.'
export const ERROR_TITLE = 'Update lockfile after audit'

export const WORKTREE_PROMPT = 'Draft release notes for version 0.5 from the commits since 0.4.'
const WORKTREE_TITLE = 'Draft 0.5 release notes'

/** A provider refusal that is not retried, so the Run fails at once. */
const HTTP_BAD_REQUEST = 400
const ERROR_REPLY_DELAY_MS = 4_000

export const MODEL_SCENARIOS: readonly ModelScenario[] = [
  {
    match: APPROVAL_PROMPT,
    title: APPROVAL_TITLE,
    replies: [
      {
        kind: 'tools',
        text: 'I’ll open the notes page in the browser preview first.',
        calls: [{ name: 'tool_search', arguments: { query: 'browser preview open page' } }],
      },
      {
        kind: 'tools',
        // A browser preview action asks first in Ask for approval, and its approval names the
        // action rather than an opaque key.
        calls: [{ name: 'preview_open', arguments: { url: 'http://localhost:5173/notes' } }],
      },
      { kind: 'text', text: 'The preview is open. I’ll look at the notes list next.' },
    ],
  },
  {
    match: WORKING_PROMPT,
    title: WORKING_TITLE,
    replies: [
      {
        kind: 'tools',
        text: 'I’ll look at how the notes list loads its data first.',
        calls: [{ name: 'bash', arguments: { command: 'ls src' } }],
      },
      {
        kind: 'hold',
        reasoning:
          'The notes list reads from the notes store. The export should reuse that query so filters apply to it too, then format each row.',
      },
    ],
  },
  {
    match: ERROR_PROMPT,
    title: ERROR_TITLE,
    replies: [
      {
        kind: 'error',
        status: HTTP_BAD_REQUEST,
        // Fails after the capture has moved on, so it is news in the sidebar: Error, not idle.
        delayMs: ERROR_REPLY_DELAY_MS,
        message:
          'The request was rejected: the attached lockfile is larger than the 10 MB request limit.',
      },
    ],
  },
  {
    match: WORKTREE_PROMPT,
    title: WORKTREE_TITLE,
    replies: [
      {
        kind: 'text',
        text: [
          '**Jotter 0.5**',
          '',
          '- Settings files move to schema version 2, with an automatic migration.',
          '- Uploads no longer retry client errors.',
        ].join('\n'),
      },
    ],
  },
]
