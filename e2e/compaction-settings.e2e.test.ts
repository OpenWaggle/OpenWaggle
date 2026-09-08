import { expect, test } from '@playwright/test'
import {
  COMPACTION_PROBE_MODEL,
  createCompactionProviderProbe,
} from '../scripts/qa/compaction-provider-probe'
import type { SessionId } from '../src/shared/types/brand'
import { SESSION_QUERY_CONTRACT_VERSION } from '../src/shared/types/session-query'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessions } from './support/session-fixtures'

const LIVE_USAGE_THREAD_TITLE = 'Live context usage'
const COMPACTION_TIMELINE_THREAD_TITLE = 'Compaction timeline'
const LIVE_USAGE_PERCENT = 37

async function readFollowUpQueue(app: OpenWaggleApp, sessionId: SessionId) {
  return app.mainWindow().page.evaluate(
    async (input) => {
      const response = await window.api.querySessionControl({
        contractVersion: input.contractVersion,
        requestId: crypto.randomUUID(),
        query: { operation: 'queue-list', sessionId: input.sessionId, includeBodies: true },
      })
      if (response.outcome.operation !== 'queue-list' || 'error' in response.outcome) {
        throw new Error(`Expected durable Follow-up queue: ${JSON.stringify(response.outcome)}`)
      }
      return response.outcome
    },
    { sessionId, contractVersion: SESSION_QUERY_CONTRACT_VERSION },
  )
}

async function readDurableSteeringMessages(app: OpenWaggleApp, sessionId: SessionId) {
  return app.mainWindow().page.evaluate(async (id) => {
    const detail = await window.api.getSessionDetail(id)
    if (!detail) throw new Error('Expected the canonical compaction Session detail.')
    return detail.messages.filter(
      (message) =>
        message.role === 'user' &&
        message.parts.find((part) => part.type === 'text')?.text === 'continue',
    )
  }, sessionId)
}

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
    await page.getByRole('button', { name: 'Increase Automatic compaction threshold' }).click()
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
        window.api.listSessionCatalogPage(false, 100),
      ])
      const session = sessions.sessions.find((candidate) => candidate.title === title)
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
        tokens: LIVE_USAGE_PERCENT * 1_000,
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
  const app = await OpenWaggleApp.launch('openwaggle-compaction-timeline-e2e-', {
    isolatedPiAgent: true,
  })
  let probe: Awaited<ReturnType<typeof createCompactionProviderProbe>> | undefined

  try {
    if (!app.piAgentDir) throw new Error('Expected an isolated Pi fixture directory.')
    probe = await createCompactionProviderProbe(app.piAgentDir, app.userDataDir)
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
    const configured = await app.mainWindow().page.evaluate(async (model) => {
      const providers = await window.api.getProviderModels()
      if (
        !providers.some((provider) => provider.models.some((candidate) => candidate.id === model))
      ) {
        throw new Error('Expected the isolated Pi loopback model in the real provider catalog.')
      }
      return window.api.updateSettings({ enabledModels: [model], selectedModel: model })
    }, COMPACTION_PROBE_MODEL)
    expect(configured).toEqual({ ok: true })
    await app.mainWindow().page.reload()
    await app.mainWindow().waitUntilReady()
    await app.mainWindow().openThread(COMPACTION_TIMELINE_THREAD_TITLE)

    const runtime = await app.mainWindow().page.evaluate(async (title) => {
      const [settings, sessions] = await Promise.all([
        window.api.getSettings(),
        window.api.listSessionCatalogPage(false, 100),
      ])
      const session = sessions.sessions.find((candidate) => candidate.title === title)
      if (!session) throw new Error('Expected seeded compaction session')
      return { sessionId: session.id, model: settings.selectedModel }
    }, COMPACTION_TIMELINE_THREAD_TITLE)

    const page = app.mainWindow().page
    await page
      .getByRole('textbox', { name: 'Message input' })
      .fill('Build context before compaction.')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect.poll(() => probe?.requests.length).toBe(1)
    await expect
      .poll(async () => (await readFollowUpQueue(app, runtime.sessionId)).activeRunId)
      .toBeNull()
    await page
      .getByRole('textbox', { name: 'Message input' })
      .fill('Keep working through compaction.')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect.poll(() => probe?.compactionPending()).toBe(true)
    const timelineStatus = page.locator('[data-compaction-timeline-state="automatic-running"]')
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
    const queued = await readFollowUpQueue(app, runtime.sessionId)
    expect(queued.activeRunId).not.toBeNull()
    expect(queued.items).toEqual([
      expect.objectContaining({ intent: expect.objectContaining({ text: 'continue' }) }),
    ])

    await page.getByRole('button', { name: 'Steer' }).click()

    await expect(page.getByRole('log').getByText('continue', { exact: true })).toBeVisible()
    await expect(page.getByText('Will send after compaction')).toBeVisible()
    await expect(page.getByText('Queued', { exact: true })).toHaveCount(0)
    expect(probe.requests).toHaveLength(2)
    expect((await readFollowUpQueue(app, runtime.sessionId)).items).toHaveLength(1)
    await app.captureEvidence('automatic-compaction-steering-pending')
    probe.releaseCompaction()

    await expect.poll(() => probe?.continuationPending()).toBe(true)
    await expect
      .poll(async () => (await readFollowUpQueue(app, runtime.sessionId)).items)
      .toEqual([])
    // The waiting label changes only when the renderer receives the promotion receipt.
    // The held model response prevents actual delivery, so clearing the preview at ACK fails.
    await expect(page.getByText('Will send after compaction')).toHaveCount(0)
    await expect(page.getByRole('log').getByText('continue', { exact: true })).toBeVisible()
    expect((await readFollowUpQueue(app, runtime.sessionId)).activeRunId).toBe(queued.activeRunId)
    expect(await readDurableSteeringMessages(app, runtime.sessionId)).toEqual([])
    expect(probe.requests).toHaveLength(3)
    expect(probe.requests[2]).not.toContain('"continue"')
    await app.captureEvidence('automatic-compaction-steering-accepted-not-delivered')
    probe.releaseContinuation()

    await expect
      .poll(() => probe?.requests.slice(3).some((body) => body.includes('"continue"')))
      .toBe(true)
    await expect
      .poll(async () => (await readFollowUpQueue(app, runtime.sessionId)).items)
      .toEqual([])
    await expect
      .poll(() => readDurableSteeringMessages(app, runtime.sessionId))
      .toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({ sessionNodeCreatedOrder: expect.any(Number) }),
        }),
      ])
    await expect(page.getByRole('log').getByText('continue', { exact: true })).toHaveCount(1)
    await expect(timelineStatus).toHaveCount(0)
    await expect(page.getByText('Will send after compaction')).toHaveCount(0)
    await expect(page.getByText('Queued', { exact: true })).toHaveCount(0)
  } finally {
    try {
      await app.cleanup()
    } finally {
      await probe?.close()
    }
  }
})
