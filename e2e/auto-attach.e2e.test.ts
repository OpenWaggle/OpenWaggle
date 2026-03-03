import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const LONG_PROMPT_SENTINEL = 'AUTO_ATTACH_SENTINEL_LONG_PROMPT_MUST_NOT_RENDER_INLINE'
const LONG_PROMPT_TEXT = `${LONG_PROMPT_SENTINEL}\n${'x'.repeat(400_000)}`
const SHORT_PROMPT_TEXT = 'hello'
const LONG_PROMPT_TOAST = 'Long prompt auto-converted to file attachment.'
const AUTO_ATTACHMENT_LABEL = 'Pasted Text 1.md'
const REGRESSION_TOOL_PATH = 'lorem-ipsum.txt'
const REGRESSION_USER_PROMPT = 'save it on the root of the project'
const REGRESSION_ASSISTANT_MODEL = 'claude-sonnet-4-5'
const REGRESSION_RUNNING_LABEL = `Writing ${REGRESSION_TOOL_PATH}...`
const REGRESSION_COMPLETED_LABEL = `Wrote ${REGRESSION_TOOL_PATH}`
const REGRESSION_THREAD_TITLE = 'Toolcall Regression'
const CONVERSATION_DIRECTORY = 'conversations'
const INDEX_FILE_NAME = 'index.json'
const UTF_8_ENCODING: BufferEncoding = 'utf-8'

async function dispatchSyntheticPaste(window: Page, text: string): Promise<void> {
  await window.evaluate((pastedText) => {
    const textarea = document.querySelector(
      'textarea[aria-label="Message input"]',
    ) as HTMLTextAreaElement | null
    if (!textarea) throw new Error('Message input not found')
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: (kind: string) => (kind === 'text' ? pastedText : ''),
      },
    })
    textarea.dispatchEvent(pasteEvent)
  }, text)
}

async function launchWithUserData(userDataDir: string) {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OPENWAGGLE_USER_DATA_DIR: userDataDir,
    },
  })
}

async function readSingleConversationFile(userDataDir: string): Promise<string> {
  const conversationsDir = path.join(userDataDir, CONVERSATION_DIRECTORY)
  const entries = await fs.readdir(conversationsDir)
  const files = entries.filter((entry) => entry.endsWith('.json') && entry !== INDEX_FILE_NAME)
  const firstFile = files[0]
  if (!firstFile) {
    throw new Error('Expected at least one conversation file')
  }
  return path.join(conversationsDir, firstFile)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function updateConversationIndex(
  userDataDir: string,
  conversationId: string,
  updatedAt: number,
  messageCount: number,
): Promise<void> {
  const indexPath = path.join(userDataDir, CONVERSATION_DIRECTORY, INDEX_FILE_NAME)

  try {
    const raw = await fs.readFile(indexPath, UTF_8_ENCODING)
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return
    if (!Array.isArray(parsed.conversations)) return

    const conversations = parsed.conversations.map((entry) => {
      if (!isRecord(entry)) return entry
      if (entry.id !== conversationId) return entry
      return {
        ...entry,
        title: REGRESSION_THREAD_TITLE,
        updatedAt,
        messageCount,
      }
    })

    await fs.writeFile(indexPath, JSON.stringify({ ...parsed, conversations }, null, 2), UTF_8_ENCODING)
  } catch {
    // Best-effort for test fixture setup
  }
}

test('long prompt auto-converts to attachment and clears the composer', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-auto-attach-'))
  const app = await launchWithUserData(userDataDir)

  try {
    const window = await app.firstWindow()
    await expect(window.getByText("Let's build")).toBeVisible()
    await window.getByRole('button', { name: 'New thread' }).first().click()

    const messageInput = window.getByRole('textbox', { name: 'Message input' })
    await messageInput.click()
    await dispatchSyntheticPaste(window, LONG_PROMPT_TEXT)

    const progressBar = window.getByRole('progressbar').first()
    await expect(progressBar).toBeVisible()
    await expect(progressBar).toHaveAttribute('aria-valuenow', '100')
    await expect(window.getByText(LONG_PROMPT_TOAST)).toBeVisible()
    await expect(window.getByText(AUTO_ATTACHMENT_LABEL)).toHaveCount(1)
    await expect(messageInput).toHaveValue('')

    await messageInput.press('Enter')
    await expect(window.getByText('[Attachment] Pasted Text 1.md')).toBeVisible()
    await expect(window.getByText(LONG_PROMPT_SENTINEL)).toBeHidden()
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('short paste does not auto-convert to attachment', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-auto-attach-'))
  const app = await launchWithUserData(userDataDir)

  try {
    const window = await app.firstWindow()
    await expect(window.getByText("Let's build")).toBeVisible()
    await window.getByRole('button', { name: 'New thread' }).first().click()

    const messageInput = window.getByRole('textbox', { name: 'Message input' })
    await messageInput.click()
    await dispatchSyntheticPaste(window, SHORT_PROMPT_TEXT)

    await expect(window.getByText(LONG_PROMPT_TOAST)).toBeHidden()
    await expect(window.getByText(AUTO_ATTACHMENT_LABEL)).toBeHidden()
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('historical unresolved tool-call does not render as running', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-toolcall-regression-'))
  let app = await launchWithUserData(userDataDir)

  try {
    const firstWindow = await app.firstWindow()
    await expect(firstWindow.getByText("Let's build")).toBeVisible()
    await firstWindow.getByRole('button', { name: 'New thread' }).first().click()
    await app.close()

    const conversationPath = await readSingleConversationFile(userDataDir)
    const rawConversation = await fs.readFile(conversationPath, UTF_8_ENCODING)
    const conversation: unknown = JSON.parse(rawConversation)
    if (!isRecord(conversation)) {
      throw new Error('Conversation payload must be an object')
    }

    const now = Date.now()
    const conversationId = path.basename(conversationPath, '.json')
    const updatedConversation = {
      ...conversation,
      title: REGRESSION_THREAD_TITLE,
      updatedAt: now,
      messages: [
        {
          id: 'user-msg-1',
          role: 'user',
          parts: [{ type: 'text', text: REGRESSION_USER_PROMPT }],
          createdAt: now - 2,
        },
        {
          id: 'assistant-msg-1',
          role: 'assistant',
          model: REGRESSION_ASSISTANT_MODEL,
          parts: [
            {
              type: 'tool-call',
              toolCall: {
                id: 'tool-call-1',
                name: 'writeFile',
                args: {
                  path: REGRESSION_TOOL_PATH,
                  content: 'hello',
                },
              },
            },
          ],
          createdAt: now - 1,
        },
      ],
    }
    await fs.writeFile(conversationPath, JSON.stringify(updatedConversation, null, 2), UTF_8_ENCODING)
    await updateConversationIndex(userDataDir, conversationId, now, updatedConversation.messages.length)

    app = await launchWithUserData(userDataDir)
    const reopenedWindow = await app.firstWindow()
    await expect(reopenedWindow.getByText("Let's build")).toBeVisible()
    await reopenedWindow.getByText(REGRESSION_THREAD_TITLE).first().click()
    await expect(reopenedWindow.getByText(REGRESSION_RUNNING_LABEL)).toBeHidden()
    await expect(reopenedWindow.getByText(REGRESSION_COMPLETED_LABEL)).toBeHidden()
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
