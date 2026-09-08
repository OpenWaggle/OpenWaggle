import { expect, test } from '@playwright/test'
import { seedSessions } from './support/session-fixtures'
import { OpenWaggleApp } from './support/openwaggle-app'

const LIVE_USAGE_THREAD_TITLE = 'Live context usage'
const COMPACTION_TIMELINE_THREAD_TITLE = 'Compaction timeline'
const LIVE_USAGE_PERCENT = 37

async function openGeneralSettings(app: OpenWaggleApp) {
  const page = app.mainWindow().page
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'General' }).click()
  await expect(page.getByRole('heading', { name: 'Context compaction' })).toBeVisible()
  return page
}

test('global automatic compaction threshold defaults to 80 percent and persists', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-compaction-settings-e2e-')

  try {
    let page = await openGeneralSettings(app)
    const threshold = page.getByRole('spinbutton', {
      name: 'Automatic compaction threshold',
    })
    await expect(page.getByRole('slider')).toHaveCount(0)
    await expect(threshold).toHaveValue('80')
    await expect(threshold).toHaveAttribute('aria-valuemin', '1')
    await expect(threshold).toHaveAttribute('aria-valuemax', '100')

    await threshold.fill('73')
    await page
      .getByRole('button', { name: 'Increase Automatic compaction threshold' })
      .click()
    await expect(threshold).toHaveValue('74')
    await expect(threshold).toBeFocused()
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.api.getSettings()).compactionThresholdPercent),
      )
      .toBe(74)

    await app.restart()
    page = await openGeneralSettings(app)
    await expect(
      page.getByRole('spinbutton', { name: 'Automatic compaction threshold' }),
    ).toHaveValue('74')
  } finally {
    await app.cleanup()
  }
})

test('composer context meter updates from usage reported before the run settles', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-context-meter-live-e2e-')

  try {
    await seedSessions(app.userDataDir, [
      {
        title: LIVE_USAGE_THREAD_TITLE,
        projectPath: app.userDataDir,
        updatedAt: Date.now(),
        messages: [
          {
            id: 'live-usage-user-message',
            role: 'user',
            createdAt: Date.now(),
            parts: [{ type: 'text', text: 'Track this long-running turn.' }],
          },
        ],
      },
    ])
    await app.restart()
    await app.mainWindow().openThread(LIVE_USAGE_THREAD_TITLE)

    const runtime = await app.mainWindow().page.evaluate(async (title) => {
      const [settings, sessions] = await Promise.all([
        window.api.getSettings(),
        window.api.listSessionDetails(),
      ])
      const session = sessions.find((candidate) => candidate.title === title)
      if (!session) {
        throw new Error('Expected seeded session')
      }
      return {
        sessionId: session.id,
        model: settings.selectedModel,
      }
    }, LIVE_USAGE_THREAD_TITLE)

    const usageEvent = {
      sessionId: runtime.sessionId,
      event: {
        type: 'context_usage',
        tokens: 37_000,
        contextWindow: 100_000,
        model: runtime.model,
        timestamp: Date.now(),
      },
    }

    const meter = app
      .mainWindow()
      .page.getByRole('img', { name: 'Context usage meter' })
      .locator('xpath=../..')
    await expect(meter).toBeVisible()
    await expect
      .poll(
        async () => {
          await app.emitAgentEvent(usageEvent)
          return meter.getAttribute('title')
        },
        { timeout: 15_000 },
      )
      .toMatch(/\(37\.0%\)$/u)
    await expect(meter.getByText('37', { exact: true })).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('automatic compaction stays in the transcript and defers explicit steering there', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-compaction-timeline-e2e-')

  try {
    await seedSessions(app.userDataDir, [
      {
        title: COMPACTION_TIMELINE_THREAD_TITLE,
        projectPath: app.userDataDir,
        updatedAt: Date.now(),
        messages: [
          {
            id: 'compaction-timeline-user-message',
            role: 'user',
            createdAt: Date.now(),
            parts: [{ type: 'text', text: 'Keep working through compaction.' }],
          },
        ],
      },
    ])
    await app.restart()
    await app.installAgentSendProbe()
    await app.installAgentSteerProbe()
    await app.mainWindow().openThread(COMPACTION_TIMELINE_THREAD_TITLE)

    const runtime = await app.mainWindow().page.evaluate(async (title) => {
      const [settings, sessions] = await Promise.all([
        window.api.getSettings(),
        window.api.listSessionDetails(),
      ])
      const session = sessions.find((candidate) => candidate.title === title)
      if (!session) throw new Error('Expected seeded compaction session')
      return { sessionId: session.id, model: settings.selectedModel }
    }, COMPACTION_TIMELINE_THREAD_TITLE)

    await app.emitAgentEvent({
      sessionId: runtime.sessionId,
      event: {
        type: 'compaction_start',
        reason: 'threshold',
        timestamp: Date.now(),
        model: runtime.model,
      },
    })

    const page = app.mainWindow().page
    const timelineStatus = page.locator(
      '[data-compaction-timeline-state="automatic-running"]',
    )
    await expect(timelineStatus).toContainText('Context automatically compacting')
    await expect(timelineStatus.locator('.compaction-shimmer')).toBeVisible()
    await expect(page.getByRole('log').getByText('Thinking...')).toHaveCount(0)
    await expect(page.getByText('Auto-compacting…')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel compaction' })).toHaveCount(0)

    await page.getByRole('textbox', { name: 'Message input' }).fill('continue')
    await page.getByRole('button', { name: 'Add message' }).click()

    await expect(page.getByText('Queued', { exact: true })).toBeVisible()
    await expect(page.getByText('Queued until compaction finishes')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Steer' })).toBeVisible()

    await page.getByRole('button', { name: 'Steer' }).click()

    await expect(page.getByRole('log').getByText('continue', { exact: true })).toBeVisible()
    await expect(page.getByText('Will send after compaction')).toBeVisible()
    await expect(page.getByText('Queued', { exact: true })).toHaveCount(0)
    await expect.poll(() => app.readAgentSteerProbe()).toMatchObject({
      received: [{ sessionId: runtime.sessionId, payload: { text: 'continue' } }],
      delivered: [],
    })

    await app.emitAgentEvent({
      sessionId: runtime.sessionId,
      event: {
        type: 'compaction_end',
        reason: 'threshold',
        result: { summary: 'Kept the active task context.', tokensBefore: 1000 },
        aborted: false,
        willRetry: false,
        timestamp: Date.now(),
        model: runtime.model,
      },
    })
    await app.releaseAgentSteerProbe()

    await expect.poll(() => app.readAgentSteerProbe()).toMatchObject({
      received: [{ sessionId: runtime.sessionId, payload: { text: 'continue' } }],
      delivered: [{ sessionId: runtime.sessionId, payload: { text: 'continue' } }],
    })
    await expect(page.getByText('Will send after compaction')).toHaveCount(0)
    await expect(page.getByText('Queued', { exact: true })).toHaveCount(0)
  } finally {
    await app.cleanup()
  }
})
