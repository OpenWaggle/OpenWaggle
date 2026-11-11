import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@playwright/test'
import { electrobunAppHome } from './support/electrobun-app-launch'
import { regionOf, shootRegion, unionRegion } from './website-screenshot-capture-kit'
import { prepareEssentials, sendMessage, sidebar } from './website-screenshot-essentials-setup'
import { MINUTE_MS } from './website-screenshot-essentials-tool-rows'
import { type CaptureContext, openSession, UI_TIMEOUT_MS, waitForUi } from './website-screenshot-ui'
import { piSessionDirectoryName } from './website-screenshot-usage-cost-fixture'

/**
 * A session started with the `pi` CLI in the jotter project, written the way Pi writes one: a
 * header, the model, the prompt and the reply, and a `/name`. It has no `openwaggle-` entries, so
 * its latest prompt came from outside OpenWaggle (`pi-session-prompt-origin.ts`), and sending a
 * message in it asks where to continue (ADR 0051). The question is dismissed afterwards, which
 * puts the message back in the composer, so nothing runs. Written after every other jotter
 * capture, so the extra sidebar row changes no earlier image.
 */

export const PI_CLI_SESSION_TITLE = 'Add a dry-run flag to export'
const PROMPT = 'Add a --dry-run flag to `jotter export` that lists the files it would write.'
const REPLY =
  'Added `--dry-run` to `jotter export`. It prints each output path and its size, and writes nothing. Tests cover both modes.'
/** Plain text from the reply (its code spans render as separate elements). */
const REPLY_MARKER = 'It prints each output path and its size'
const FOLLOW_UP = 'Also print the total size at the end.'
const QUESTION = 'Continue this session in OpenWaggle?'
const PI_SESSION_VERSION = 3
const SESSION_ID = '6f1c2a9e-3b7d-4e58-9a10-c4d2e8f7b153'
/** How long ago the pi session ran, so the sidebar shows it as recent. */
const STARTED_AGO_MS = 25 * MINUTE_MS
const REPLIED_AGO_MS = 22 * MINUTE_MS
/** Fixed entry ids, full UUIDs like the ones Pi writes, so every run writes the same file. */
const ENTRY_IDS = {
  model: '0b7e4c1a-52d9-4f3e-8a61-9d2c7b4e5f10',
  prompt: '1c8f5d2b-63ea-4a4f-9b72-ae3d8c5f6a21',
  reply: '2d9a6e3c-74fb-4b5a-8c83-bf4e9d6a7b32',
  name: '3eab7f4d-85ac-4c6b-9d94-c05fae7b8c43',
} as const
/** The reply's recorded token usage. */
const REPLY_USAGE = { input: 4_210, output: 380, cacheRead: 0, cacheWrite: 0 } as const
/** A margin of the dimmed window around the question. */
const BACKDROP_PX = 32

async function writePiCliSession(context: CaptureContext, projectPath: string) {
  const { piAgentDir } = electrobunAppHome(context)
  const now = Date.now()
  const at = (agoMs: number) => new Date(now - agoMs).toISOString()
  const lines = [
    {
      type: 'session',
      version: PI_SESSION_VERSION,
      id: SESSION_ID,
      timestamp: at(STARTED_AGO_MS),
      cwd: projectPath,
    },
    {
      type: 'model_change',
      id: ENTRY_IDS.model,
      parentId: null,
      timestamp: at(STARTED_AGO_MS),
      provider: 'openai',
      modelId: 'gpt-5.4',
    },
    {
      type: 'message',
      id: ENTRY_IDS.prompt,
      parentId: ENTRY_IDS.model,
      timestamp: at(STARTED_AGO_MS),
      message: {
        role: 'user',
        content: [{ type: 'text', text: PROMPT }],
        timestamp: now - STARTED_AGO_MS,
      },
    },
    {
      type: 'message',
      id: ENTRY_IDS.reply,
      parentId: ENTRY_IDS.prompt,
      timestamp: at(REPLIED_AGO_MS),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: REPLY }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-5.4',
        // Without a cost, like the pi CLI sessions in the Usage & Cost fixture.
        usage: { ...REPLY_USAGE, totalTokens: REPLY_USAGE.input + REPLY_USAGE.output },
        stopReason: 'stop',
        timestamp: now - REPLIED_AGO_MS,
      },
    },
    {
      type: 'session_info',
      id: ENTRY_IDS.name,
      parentId: ENTRY_IDS.reply,
      timestamp: at(REPLIED_AGO_MS),
      name: PI_CLI_SESSION_TITLE,
    },
  ]
  const directory = path.join(piAgentDir, 'sessions', piSessionDirectoryName(projectPath))
  await fs.mkdir(directory, { recursive: true })
  const stamp = at(STARTED_AGO_MS).replace(/[:.]/g, '-')
  await fs.writeFile(
    path.join(directory, `${stamp}_${SESSION_ID}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
  )
}

/** The question OpenWaggle asks before it continues a session that `pi` used last. */
export async function capturePiSessionContinuePrompt(context: CaptureContext) {
  const { page } = context
  const { project } = await prepareEssentials(context)
  await writePiCliSession(context, project.projectPath)
  // OpenWaggle lists a new pi session a few seconds after its file appears.
  await expect(
    sidebar(page).getByRole('button', { name: PI_CLI_SESSION_TITLE, exact: true }),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await openSession(page, PI_CLI_SESSION_TITLE)
  await page.getByText(REPLY_MARKER).first().waitFor({ timeout: UI_TIMEOUT_MS })
  await sendMessage(page, FOLLOW_UP)
  const dialog = page.getByRole('dialog', { name: QUESTION })
  await dialog.waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  await shootRegion(
    context,
    'pi-session-continue-prompt.png',
    async () => unionRegion([await regionOf(dialog)], BACKDROP_PX),
    { keepFocus: true },
  )
  // Dismissing the question keeps the message in the composer and sends nothing.
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
}
