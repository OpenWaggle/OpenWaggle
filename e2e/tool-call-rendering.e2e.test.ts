import { test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import {
  makeAssistantMessage,
  makeUserMessage,
  makeWriteToolCallPart,
  makeWriteToolResultPart,
  REGRESSION_COMPLETED_LABEL,
  REGRESSION_PENDING_LABEL,
  REGRESSION_RUNNING_LABEL,
  REGRESSION_TOOL_CONTENT,
  REGRESSION_TOOL_PATH,
  REGRESSION_USER_PROMPT,
  restartAndOpenThread,
  seedRegressionSession,
} from './support/tool-call-regression-fixtures'

test('historical unresolved Pi write tool-call does not render as running', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-toolcall-regression-')

  try {
    const title = await seedRegressionSession(app, [
      makeUserMessage(REGRESSION_USER_PROMPT, Date.now() - 2),
      makeAssistantMessage(
        [makeWriteToolCallPart('tool-call-1', REGRESSION_TOOL_PATH, REGRESSION_TOOL_CONTENT)],
        Date.now() - 1,
      ),
    ])

    const mainWindow = await restartAndOpenThread(app, title)
    await mainWindow.expectTextVisible(REGRESSION_PENDING_LABEL)
    await mainWindow.expectTextHidden(REGRESSION_RUNNING_LABEL)
    await mainWindow.expectTextHidden(REGRESSION_COMPLETED_LABEL)
  } finally {
    await app.cleanup()
  }
})

test('concrete Pi write result renders completed after reload', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-toolcall-regression-')

  try {
    const title = await seedRegressionSession(app, [
      makeUserMessage(REGRESSION_USER_PROMPT, Date.now() - 2),
      makeAssistantMessage(
        [
          makeWriteToolCallPart(
            'tool-call-concrete-result',
            REGRESSION_TOOL_PATH,
            REGRESSION_TOOL_CONTENT,
          ),
          makeWriteToolResultPart(
            'tool-call-concrete-result',
            REGRESSION_TOOL_PATH,
            REGRESSION_TOOL_CONTENT,
            { content: [{ type: 'text', text: 'File written: lorem-ipsum.txt' }] },
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
  } finally {
    await app.cleanup()
  }
})
