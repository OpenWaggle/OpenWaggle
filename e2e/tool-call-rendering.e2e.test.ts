import { test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import {
  makeAssistantMessage,
  makeUserMessage,
  makeWriteFileToolCallPart,
  makeWriteFileToolResultPart,
  REGRESSION_COMPLETED_LABEL,
  REGRESSION_PENDING_LABEL,
  REGRESSION_RUNNING_LABEL,
  REGRESSION_TOOL_CONTENT,
  REGRESSION_TOOL_PATH,
  REGRESSION_USER_PROMPT,
  restartAndOpenThread,
  seedRegressionConversation,
} from './support/tool-call-regression-fixtures'

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

test('concrete write result clears stale approval-needed UI after reload', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-toolcall-regression-')

  try {
    const title = await seedRegressionConversation(app, [
      makeUserMessage(REGRESSION_USER_PROMPT, Date.now() - 2),
      makeAssistantMessage(
        [
          makeWriteFileToolCallPart(
            'tool-call-concrete-result',
            REGRESSION_TOOL_PATH,
            REGRESSION_TOOL_CONTENT,
            {
              state: 'approval-requested',
              approval: {
                id: 'approval_tool-call-concrete-result',
                needsApproval: true,
              },
            },
          ),
          makeWriteFileToolResultPart(
            'tool-call-concrete-result',
            REGRESSION_TOOL_PATH,
            REGRESSION_TOOL_CONTENT,
            '{"kind":"json","data":{"message":"File written: lorem-ipsum.txt"}}',
            false,
            1,
          ),
        ],
        Date.now() - 1,
      ),
    ])

    const mainWindow = await restartAndOpenThread(app, title)
    await mainWindow.expectTextVisible(REGRESSION_COMPLETED_LABEL)
    await mainWindow.expectTextHidden(REGRESSION_PENDING_LABEL)
    await mainWindow.expectTextHidden('(approval needed)')
    await mainWindow.expectApproveButtonHidden()
  } finally {
    await app.cleanup()
  }
})
