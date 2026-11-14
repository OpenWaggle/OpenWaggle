import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@playwright/test'
import Database from 'better-sqlite3'
import { getDatabasePath, seedSingleSession } from './support/session-fixtures'
import { prepareEssentials, sidebar } from './website-screenshot-essentials-setup'
import { MINUTE_MS } from './website-screenshot-essentials-tool-rows'
import { type CaptureContext, UI_TIMEOUT_MS } from './website-screenshot-ui'

/**
 * A jotter session whose reply holds a visualization, followed by one more exchange: the user's
 * next message and the agent's answer. Stored the way the visualize skill stores a
 * visualization: an HTML fragment in the session's visualization directory
 * (`<userData>/visualizations/<session>`), and a `visualize{...}` reference on its own line of
 * the reply.
 */
export interface VisualizationConversation {
  readonly sessionTitle: string
  readonly file: string
  readonly visualizationTitle: string
  readonly fragment: string
  readonly prompt: string
  readonly replyBefore: string
  readonly replyAfter: string
  readonly nextMessage: string
  readonly answer: string
}

const MODEL_ID = 'gpt-5.4'
/** How many minutes ago each of the four messages was sent, oldest first. */
const SENT_MINUTES_AGO = [9, 8, 3, 2] as const

function textMessage(id: string, role: 'user' | 'assistant', createdAt: number, text: string) {
  return {
    id,
    role,
    createdAt,
    ...(role === 'assistant' ? { model: MODEL_ID } : {}),
    parts: [{ type: 'text', text }],
  }
}

async function seed(context: CaptureContext, conversation: VisualizationConversation) {
  const { project } = await prepareEssentials(context)
  const now = Date.now()
  const sentAt = (minutesAgo: number) => now - minutesAgo * MINUTE_MS
  const [askedAgo, repliedAgo, nextAgo, answeredAgo] = SENT_MINUTES_AGO
  const asked = sentAt(askedAgo)
  const replied = sentAt(repliedAgo)
  const next = sentAt(nextAgo)
  const answered = sentAt(answeredAgo)
  const replyId = `website-${conversation.file.replace(/\.html$/, '')}-reply`
  const sessionId = await seedSingleSession(context.userDataDir, {
    title: conversation.sessionTitle,
    projectPath: project.projectPath,
    updatedAt: answered,
    messages: [
      textMessage(`${replyId}-prompt`, 'user', asked, conversation.prompt),
      textMessage(replyId, 'assistant', replied, conversation.replyBefore),
      textMessage(`${replyId}-next`, 'user', next, conversation.nextMessage),
      textMessage(`${replyId}-answer`, 'assistant', answered, conversation.answer),
    ],
  })
  // The reference names the file by its absolute path in the session's directory, which needs
  // the session's id, so the reply's text is written once the session exists.
  const directory = path.join(context.userDataDir, 'visualizations', sessionId)
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, conversation.file)
  await fs.writeFile(file, conversation.fragment)
  const reference = `visualize${JSON.stringify({ path: file, title: conversation.visualizationTitle })}`
  const text = [conversation.replyBefore, '', reference, '', conversation.replyAfter].join('\n')
  const database = new Database(getDatabasePath(context.userDataDir))
  try {
    database
      .prepare('UPDATE session_nodes SET content_json = ? WHERE id = ?')
      .run(JSON.stringify({ parts: [{ type: 'text', text }], model: MODEL_ID }), replyId)
  } finally {
    database.close()
  }
  await context.page.reload()
  await expect(
    sidebar(context.page).getByRole('button', { name: conversation.sessionTitle, exact: true }),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

const seeded = new WeakMap<CaptureContext['page'], Map<string, Promise<void>>>()

/** Seeds the conversation once per run. */
export function ensureVisualizationConversation(
  context: CaptureContext,
  conversation: VisualizationConversation,
) {
  const forPage = seeded.get(context.page) ?? new Map<string, Promise<void>>()
  seeded.set(context.page, forPage)
  const existing = forPage.get(conversation.file)
  if (existing) return existing
  const next = seed(context, conversation)
  forPage.set(conversation.file, next)
  return next
}
