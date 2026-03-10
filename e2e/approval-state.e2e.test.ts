import { test } from '@playwright/test'
import type { SeedConversationInput } from './support/conversation-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'
import {
  makeAssistantMessage,
  makeUserMessage,
  makeWriteFileToolCallPart,
  makeWriteFileToolResultPart,
  REGRESSION_TOOL_CONTENT,
  REGRESSION_TOOL_PATH,
  restartAndOpenThread,
  seedPendingApprovalConversations,
  seedRegressionConversation,
} from './support/tool-call-regression-fixtures'

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

    await seedPendingApprovalConversations(app.userDataDir, seededConversations)

    const reopenedWindow = await restartAndOpenThread(app, primaryTitle)
    await reopenedWindow.expectApproveButtonVisible()
    await reopenedWindow.openThread(secondaryTitle)
    await reopenedWindow.openThread(primaryTitle)
    await reopenedWindow.expectApproveButtonVisible()
  } finally {
    await app.cleanup()
  }
})
