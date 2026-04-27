import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import {
  makeWaggleRegressionConversation,
  WAGGLE_REGRESSION_PROMPT,
  WAGGLE_REGRESSION_THREAD_TITLE,
  WAGGLE_REGRESSION_TURN_CONTENTS,
  WAGGLE_REGRESSION_TURN_LABELS,
} from './support/waggle-regression-fixtures'

test('waggle transcript keeps clean turn order and preserves the initiating user prompt', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-waggle-streaming-')

  try {
    await makeWaggleRegressionConversation(app.userDataDir)
    await app.restart()

    const mainWindow = app.mainWindow()
    await mainWindow.openThread(WAGGLE_REGRESSION_THREAD_TITLE)

    await mainWindow.expectTextVisible(WAGGLE_REGRESSION_PROMPT)
    await mainWindow.expectUserMessageAttributeCount(1)

    for (const expectedContent of WAGGLE_REGRESSION_TURN_CONTENTS) {
      await mainWindow.expectTextVisible(expectedContent)
    }

    const turnLabels = await app.window().evaluate(() =>
      Array.from(document.querySelectorAll('[role="log"] span'))
        .map((node) => node.textContent?.trim() ?? '')
        .filter((text) => /^Turn \d+:/.test(text)),
    )
    expect(turnLabels).toEqual([...WAGGLE_REGRESSION_TURN_LABELS])
  } finally {
    await app.cleanup()
  }
})
