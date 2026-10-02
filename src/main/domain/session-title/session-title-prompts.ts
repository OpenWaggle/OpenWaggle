/**
 * Title prompts for OpenWaggle Sessions.
 *
 * Ported from T3 Code (`apps/server/src/textGeneration/TextGenerationPrompts.ts`,
 * https://github.com/pingdotgg/t3code, MIT License, Copyright (c) 2026 T3 Tools Inc.) per ADR 0043,
 * adapted to say "OpenWaggle session", to write in the user's language, and without linked pull
 * request or issue lookup. The rule for conversational openers comes from OpenCode's title prompt
 * (`packages/opencode/src/agent/prompt/title.txt`, https://github.com/anomalyco/opencode, MIT
 * License, Copyright (c) 2025 opencode). Both licenses are reproduced in THIRD_PARTY_NOTICES.md,
 * which ships with the app. Keep the shared editorial rules of the two prompts in sync; the
 * regeneration prompt intentionally adds guidance for history and the previous title.
 */

import type { SessionTitleContextAttachment } from './session-title-context'
import { limitTitleMessage } from './session-title-text'

const INITIAL_SESSION_TITLE_PROMPT = `Generate a title that will help the user recognize this OpenWaggle session weeks later.
Return only JSON with keys title and needsRefinement, for example {"title":"Fix sidebar row overlap","needsRefinement":false}.
Set needsRefinement to true only if the subject is still unknown, such as an unread link, "fix this", or an unexplained attachment. Otherwise set it to false.

Before answering, silently reduce the request to:
- Subject: What system, feature, or problem is this really about?
- Outcome: What does the user ultimately want to understand or change?
- Incidental instructions: What only describes how the agent should do the work?

Title the subject and outcome. Discard incidental instructions.

Editorial rules:
- 3-8 words, fewer than 40 characters.
- Write the title in the same language as the user's request.
- Use a compact noun phrase or clear action phrase.
- Capture the umbrella goal when the request lists several symptoms or steps.
- Name the product change, not the mock, plan, report, branch, or PR used to produce it.
- Models, subagents, workers, tools, output formats, and monitoring instructions do not belong in the title unless they are themselves the topic.
- For reviews, name what is being reviewed and the relevant concern. Avoid generic titles such as "Review PR 123" when the request reveals the subject.
- For research, name the question domain rather than the requested research process.
- Do not claim the work is complete.
- Do not copy and truncate the user's message.
- Avoid project names, quotes, labels, filler, and trailing punctuation.
- Use attachment names as context for what the user shared.
- Do not answer the request, and never refuse: always return a title.
- Never return "New session" or another placeholder. If the request is short or conversational, such as "hello" or "hey", name its tone or intent, such as "Greeting" or "Quick check-in", and set needsRefinement to true.
- If a linked PR or issue is the only source of the subject, fall back to the user's stated action plus its number, such as "Take over PR 8588". This is the one case where a PR or issue number belongs in the title.`

function regenerateSessionTitlePrompt(previousTitle: string) {
  return `Regenerate the title for an existing OpenWaggle session so the user can recognize it weeks later.
The previous title was ${JSON.stringify(previousTitle)}.
Return only JSON with keys title and needsRefinement. Set needsRefinement to false.

Determine the title in this order:
1. Read the USER messages first. Identify the latest explicit durable goal. The original subject remains the subject until the user clearly changes what the session is about.
2. Use ASSISTANT messages to resolve vague links, unnamed code, and discovered product nouns. Do not promote one assistant finding into the session subject unless the user adopts it as a new goal.
3. Compare that subject with the previous title. Preserve accurate scope words, especially when earlier content is truncated. Replace the previous title when it is generic, artifact-based, a completion update, a copy of the first message, or contradicted by the session.
4. Title the durable subject and desired outcome, not the current workflow state.

Editorial rules:
- 3-8 words, fewer than 40 characters.
- Write the title in the same language as the user's messages.
- Use a compact noun phrase or clear action phrase.
- Preserve the umbrella subject when later messages focus on one finding, provider, platform, or implementation detail.
- A session progressing through research, planning, implementation, review, CI, merge, and monitoring has usually not changed subjects.
- Ignore deliverables and operations such as mocks, plans, HTML, branches, PRs, tests, CI, commits, merging, and monitoring unless they are the actual topic.
- Models, subagents, workers, tools, output formats, and monitoring instructions do not belong in the title unless they are themselves the topic.
- Treat final operational follow-ups and assistant completion summaries as weak evidence of subject.
- For reviews, name the reviewed feature or system and its durable concern, not one finding from the review.
- For research, name the question domain rather than the research process.
- Do not claim the work is complete.
- Do not copy and truncate a session message.
- Avoid project names, PR numbers, quotes, labels, filler, and trailing punctuation.
- Use attachment names as context for what the user shared.
- Do not answer any message, and never refuse: always return a title.
- Never return "New session", "OpenWaggle session", or another placeholder. If the session is only conversational, name its tone or intent, such as "Greeting" or "Quick check-in".
- If a linked PR or issue is the only source of the subject, fall back to the user's stated action plus its number, such as "Take over PR 8588". This is the one case where a PR or issue number belongs in the title.
- Keep the previous title unchanged if it is already accurate. Otherwise return a meaningfully improved title, not a cosmetic paraphrase.

Examples of the distinction:
- A subagent-monitoring review that finds a roster bug remains "Review subagent monitoring risks", not "Roster bug review".
- A vague failing-test request later identified as a lazy feed mismatch becomes "Fix lazy feed test", not "Prevent mobile feed regressions".
- A QR-sharing overhaul that ends with CI and merge work remains about QR sharing, not the PR lifecycle.`
}

const INITIAL_MESSAGE_BUDGET = 8_000
const ATTACHMENT_SECTION_BUDGET = 4_000
const EARLIER_CONTENT_TRUNCATED = '[Earlier content truncated]\n\n'

function preserveMessageEnd(message: string) {
  const alreadyTruncated = message.startsWith(EARLIER_CONTENT_TRUNCATED)
  const contents = alreadyTruncated ? message.slice(EARLIER_CONTENT_TRUNCATED.length) : message
  if (!alreadyTruncated && contents.length <= INITIAL_MESSAGE_BUDGET) return contents
  return `${EARLIER_CONTENT_TRUNCATED}${contents.slice(-INITIAL_MESSAGE_BUDGET)}`
}

function attachmentSuffix(attachments: readonly SessionTitleContextAttachment[]) {
  if (attachments.length === 0) return ''
  const lines = attachments
    .map((attachment) => `- ${attachment.name} (${attachment.mimeType})`)
    .join('\n')
  const bounded =
    lines.length <= ATTACHMENT_SECTION_BUDGET
      ? lines
      : `${lines.slice(0, ATTACHMENT_SECTION_BUDGET)}\n[truncated]`
  return `\n\nAttachment metadata:\n${bounded}`
}

export interface SessionTitlePrompt {
  readonly systemPrompt: string
  readonly prompt: string
}

export interface SessionTitlePromptInput {
  /** The first message, or a formatted history when regenerating. */
  readonly message: string
  /** Present when regenerating or refining an existing title. */
  readonly previousTitle?: string
  readonly attachments?: readonly SessionTitleContextAttachment[]
}

export function buildSessionTitlePrompt(input: SessionTitlePromptInput): SessionTitlePrompt {
  const attachments = attachmentSuffix(input.attachments ?? [])
  if (input.previousTitle === undefined) {
    return {
      systemPrompt: INITIAL_SESSION_TITLE_PROMPT,
      prompt: `User message:\n${limitTitleMessage(input.message, INITIAL_MESSAGE_BUDGET)}${attachments}`,
    }
  }
  return {
    systemPrompt: regenerateSessionTitlePrompt(input.previousTitle),
    prompt: `Session contents:\n${preserveMessageEnd(input.message)}${attachments}`,
  }
}
