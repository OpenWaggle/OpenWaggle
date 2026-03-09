import { expect, test } from '@playwright/test'
import type { SeedConversationInput } from './support/conversation-fixtures'
import { seedConversations, seedSingleConversation } from './support/conversation-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

const LONG_PROMPT_SENTINEL = 'AUTO_ATTACH_SENTINEL_LONG_PROMPT_MUST_NOT_RENDER_INLINE'
const LONG_PROMPT_TEXT = `${LONG_PROMPT_SENTINEL}\n${'x'.repeat(400_000)}`
const SHORT_PROMPT_TEXT = 'hello'
const LONG_PROMPT_TOAST = 'Long prompt auto-converted to file attachment.'
const AUTO_ATTACHMENT_LABEL = 'Pasted Text 1.md'

const REGRESSION_ASSISTANT_MODEL = 'claude-sonnet-4-5'
const REGRESSION_THREAD_TITLE = 'Toolcall Regression'
const REGRESSION_TOOL_PATH = 'lorem-ipsum.txt'
const REGRESSION_TOOL_CONTENT = 'hello'
const REGRESSION_USER_PROMPT = 'save it on the root of the project'
const REGRESSION_RUNNING_LABEL = `Writing ${REGRESSION_TOOL_PATH}...`
const REGRESSION_COMPLETED_LABEL = `Wrote ${REGRESSION_TOOL_PATH}`
const REGRESSION_PENDING_LABEL = `Requested writeFile ${REGRESSION_TOOL_PATH}`

function makeUserMessage(text: string, createdAt: number) {
  return {
    id: `user-msg-${String(createdAt)}`,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text }],
    createdAt,
  }
}

function makeAssistantMessage(parts: readonly unknown[], createdAt: number) {
  return {
    id: `assistant-msg-${String(createdAt)}`,
    role: 'assistant' as const,
    model: REGRESSION_ASSISTANT_MODEL,
    parts: [...parts],
    createdAt,
  }
}

function makeWriteFileToolCallPart(
  id: string,
  path: string,
  content: string,
  options?: {
    readonly state?: 'approval-requested' | 'approval-responded'
    readonly approval?: {
      readonly id: string
      readonly needsApproval: boolean
      readonly approved?: boolean
    }
  },
) {
  return {
    type: 'tool-call' as const,
    toolCall: {
      id,
      name: 'writeFile',
      args: { path, content },
      state: options?.state,
      approval: options?.approval,
    },
  }
}

function makeWriteFileToolResultPart(
  id: string,
  path: string,
  content: string,
  result: string,
  isError: boolean,
  duration = 0,
) {
  return {
    type: 'tool-result' as const,
    toolResult: {
      id,
      name: 'writeFile',
      args: { path, content },
      result,
      isError,
      duration,
    },
  }
}

async function seedRegressionConversation(
  app: OpenWaggleApp,
  messages: readonly unknown[],
  options?: {
    readonly title?: string
    readonly updatedAt?: number
    readonly projectPath?: string | null
    readonly archived?: boolean
  },
): Promise<string> {
  const updatedAt = options?.updatedAt ?? Date.now()
  const title = options?.title ?? REGRESSION_THREAD_TITLE

  await app.mainWindow().createNewThread()
  await seedSingleConversation(app.userDataDir, {
    title,
    updatedAt,
    messages,
    projectPath: options?.projectPath,
    archived: options?.archived,
  })

  return title
}

async function restartAndOpenThread(app: OpenWaggleApp, title: string) {
  await app.restart()
  const mainWindow = app.mainWindow()
  await mainWindow.openThread(title)
  return mainWindow
}

test('long prompt auto-converts to attachment and clears the composer', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-auto-attach-')

  try {
    const mainWindow = app.mainWindow()
    await mainWindow.createNewThread()
    await mainWindow.pasteIntoComposer(LONG_PROMPT_TEXT)

    await expect(mainWindow.progressBar()).toBeVisible()
    await expect(mainWindow.progressBar()).toHaveAttribute('aria-valuenow', '100')
    await mainWindow.expectTextVisible(LONG_PROMPT_TOAST)
    await mainWindow.expectAttachmentCount(AUTO_ATTACHMENT_LABEL, 1)
    await mainWindow.expectComposerValue('')

    await mainWindow.submitComposer()
    await mainWindow.expectAttachmentVisible(AUTO_ATTACHMENT_LABEL)
    await mainWindow.expectTextHidden(LONG_PROMPT_SENTINEL)
  } finally {
    await app.cleanup()
  }
})

test('short paste does not auto-convert to attachment', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-auto-attach-')

  try {
    const mainWindow = app.mainWindow()
    await mainWindow.createNewThread()
    await mainWindow.pasteIntoComposer(SHORT_PROMPT_TEXT)

    await mainWindow.expectTextHidden(LONG_PROMPT_TOAST)
    await mainWindow.expectTextHidden(AUTO_ATTACHMENT_LABEL)
  } finally {
    await app.cleanup()
  }
})

test('historical unresolved tool-call does not render as running', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-toolcall-regression-')

  try {
    const title = await seedRegressionConversation(app, [
      makeUserMessage(REGRESSION_USER_PROMPT, Date.now() - 2),
      makeAssistantMessage(
        [makeWriteFileToolCallPart('tool-call-1', REGRESSION_TOOL_PATH, REGRESSION_TOOL_CONTENT)],
        Date.now() - 1,
      ),
    ])

    const mainWindow = await restartAndOpenThread(app, title)
    await mainWindow.expectTextHidden(REGRESSION_RUNNING_LABEL)
    await mainWindow.expectTextHidden(REGRESSION_COMPLETED_LABEL)
  } finally {
    await app.cleanup()
  }
})

test('approval pendingExecution placeholder does not render as completed write', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-toolcall-regression-')

  try {
    const title = await seedRegressionConversation(app, [
      makeUserMessage(REGRESSION_USER_PROMPT, Date.now() - 2),
      makeAssistantMessage(
        [
          makeWriteFileToolCallPart('tool-call-1', REGRESSION_TOOL_PATH, REGRESSION_TOOL_CONTENT),
          makeWriteFileToolResultPart(
            'tool-call-1',
            REGRESSION_TOOL_PATH,
            REGRESSION_TOOL_CONTENT,
            '{"kind":"json","data":{"approved":true,"pendingExecution":true}}',
            false,
          ),
        ],
        Date.now() - 1,
      ),
    ])

    const mainWindow = await restartAndOpenThread(app, title)
    await mainWindow.expectTextVisible(REGRESSION_PENDING_LABEL)
    await mainWindow.expectTextHidden(REGRESSION_COMPLETED_LABEL)
  } finally {
    await app.cleanup()
  }
})

test('persisted denied approval does not re-render approval controls after reload', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-toolcall-denied-')

  try {
    const deniedPath = 'should-not-exist.txt'
    const deniedPendingLabel = `Requested writeFile ${deniedPath}`
    const deniedFailedLabel = `Failed writeFile ${deniedPath}`
    const title = await seedRegressionConversation(app, [
      makeUserMessage('write a denied file', Date.now() - 2),
      makeAssistantMessage(
        [
          makeWriteFileToolCallPart('tool-call-denied', deniedPath, 'denied'),
          makeWriteFileToolResultPart(
            'tool-call-denied',
            deniedPath,
            'denied',
            '{"approved":false,"message":"User declined tool execution"}',
            true,
          ),
        ],
        Date.now() - 1,
      ),
    ])

    const mainWindow = await restartAndOpenThread(app, title)
    await mainWindow.expectTextVisible(deniedFailedLabel)
    await mainWindow.expectTextHidden(deniedPendingLabel)
    await mainWindow.expectApproveButtonHidden()
  } finally {
    await app.cleanup()
  }
})

test('later terminal tool state replaces earlier pending duplicate after reload', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-toolcall-dedup-')

  try {
    const duplicatePath = 'duplicate-denied-check.txt'
    const duplicateContent = 'reload should not fake success'
    const pendingLabel = `Requested writeFile ${duplicatePath}`
    const terminalText = 'The file write was denied and no file was created.'
    const title = await seedRegressionConversation(app, [
      makeUserMessage('create a file', Date.now() - 3),
      makeAssistantMessage(
        [
          { type: 'text' as const, text: "I'll create that file for you." },
          makeWriteFileToolCallPart('tool-call-duplicate', duplicatePath, duplicateContent, {
            state: 'approval-requested',
            approval: {
              id: 'approval_tool-call-duplicate-1',
              needsApproval: true,
            },
          }),
        ],
        Date.now() - 2,
      ),
      makeAssistantMessage(
        [
          makeWriteFileToolCallPart('tool-call-duplicate', duplicatePath, duplicateContent, {
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-call-duplicate',
              needsApproval: true,
              approved: false,
            },
          }),
          makeWriteFileToolResultPart(
            'tool-call-duplicate',
            duplicatePath,
            duplicateContent,
            '{"approved":false,"message":"User declined tool execution"}',
            true,
            1,
          ),
          { type: 'text' as const, text: terminalText },
        ],
        Date.now() - 1,
      ),
    ])

    const mainWindow = await restartAndOpenThread(app, title)
    await mainWindow.expectTextVisible(terminalText)
    await mainWindow.expectTextHidden(pendingLabel)
    await mainWindow.expectApproveButtonHidden()
  } finally {
    await app.cleanup()
  }
})

test('pending approval stays visible after switching conversations and back', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-pending-switch-')

  try {
    const primaryUpdatedAt = Date.now()
    const secondaryUpdatedAt = primaryUpdatedAt - 3
    const primaryTitle = 'Pending Switch Check'
    const secondaryTitle = 'Other Thread'
    const pendingPath = 'pending-switch-check.txt'
    const pendingToolName = 'dangerousAction'

    const mainWindow = app.mainWindow()
    await mainWindow.createNewThread()
    await mainWindow.createNewThread()

    const seededConversations: readonly SeedConversationInput[] = [
      {
        title: primaryTitle,
        updatedAt: primaryUpdatedAt,
        messages: [
          makeUserMessage('create a pending file', primaryUpdatedAt - 2),
          makeAssistantMessage(
            [
              {
                type: 'tool-call' as const,
                toolCall: {
                  id: 'tool-call-pending-switch',
                  name: pendingToolName,
                  args: {
                    path: pendingPath,
                    content: 'pending switch check',
                  },
                  state: 'approval-requested',
                  approval: {
                    id: 'approval_tool-call-pending-switch',
                    needsApproval: true,
                  },
                },
              },
            ],
            primaryUpdatedAt - 1,
          ),
        ],
      },
      {
        title: secondaryTitle,
        updatedAt: secondaryUpdatedAt,
        messages: [],
      },
    ]

    await seedConversations(app.userDataDir, seededConversations)

    const reopenedWindow = await restartAndOpenThread(app, primaryTitle)
    await reopenedWindow.expectApproveButtonVisible()
    await reopenedWindow.openThread(secondaryTitle)
    await reopenedWindow.openThread(primaryTitle)
    await reopenedWindow.expectApproveButtonVisible()
  } finally {
    await app.cleanup()
  }
})
