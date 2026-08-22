import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

/**
 * The access-mode surfaces in the real application.
 *
 * A pending authorization request and a live notification only exist in flight, so seeding the
 * database cannot produce either. These tests emit the same `agent:event` payloads the main process
 * emits during a run, so the renderer's own preload listener, stream reducer and projection all run,
 * and the ribbon and the notification stack are exercised rather than asserted absent.
 */

const SESSION_TITLE = 'Access mode surfaces'
const RUN_ID = 'run-access-modes'

function authorizationRequest(sessionId: string) {
  return {
    sessionId,
    event: {
      type: 'agent_interaction_request',
      timestamp: Date.now(),
      interaction: {
        interactionId: 'e2e-authorization-1',
        sessionId,
        runId: RUN_ID,
        kind: 'confirm',
        source: 'pi-ui',
        createdAt: Date.now(),
        title: 'Allow GitHub Issues to reach api.github.com?',
        message: 'Server: github-issues\nTool: List issues (list_issues)',
        purpose: 'authorization',
        scopeKey: {
          requester: 'github-issues',
          capability: 'mcp.tool-call',
          resource: 'list_issues',
        },
      },
    },
  }
}

function notification(sessionId: string, level: 'info' | 'warning' | 'error', message: string) {
  return {
    sessionId,
    event: {
      type: 'agent_interaction_request',
      timestamp: Date.now(),
      interaction: {
        interactionId: `e2e-notify-${level}`,
        sessionId,
        runId: RUN_ID,
        kind: 'notify',
        source: 'pi-ui',
        createdAt: Date.now(),
        message,
        level,
      },
    },
  }
}

async function openSeededSession(app: OpenWaggleApp) {
  const sessionId = await seedSingleSession(app.userDataDir, {
    title: SESSION_TITLE,
    updatedAt: Date.now(),
    messages: [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Check the open GitHub issues.' }],
        createdAt: Date.now() - 1,
      },
    ],
  })

  await app.restart()
  const mainWindow = app.mainWindow()
  await mainWindow.openThread(SESSION_TITLE)
  return { mainWindow, sessionId }
}

test('the composer access control reads compact and opens to the full label', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-access-modes-')

  try {
    const { mainWindow } = await openSeededSession(app)
    const page = mainWindow.page
    const select = page.getByRole('combobox', { name: 'Session access mode' })

    await expect(select).toBeVisible()
    // Closed: the compact label, because the row already carries the model, run target and branch.
    await expect(page.getByRole('option', { name: 'YOLO', exact: true })).toBeAttached()

    await select.focus()
    await expect(page.getByRole('option', { name: 'YOLO (Full access)' })).toBeAttached()
  } finally {
    await app.cleanup()
  }
})

test('a pending authorization request adds a ribbon without disturbing the composer', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-access-ribbon-')

  try {
    const { mainWindow, sessionId } = await openSeededSession(app)
    const page = mainWindow.page

    // A half-written thought, focused, before the request arrives.
    await mainWindow.messageInput().click()
    await page.keyboard.type('also check whether any are already fixed on main')
    const draftBefore = await mainWindow.messageInput().innerText()

    await app.emitAgentEvent(authorizationRequest(sessionId))

    const ribbon = page.locator('[data-request-ribbon="true"]')
    await expect(ribbon).toBeVisible()
    await expect(page.getByText('Needs decision')).toBeVisible()
    await expect(page.getByText('github-issues', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('list_issues · Run a tool')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue without' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible()

    // The composer is untouched: same draft, still enabled, caret still inside it.
    await expect(mainWindow.messageInput()).toHaveText(draftBefore)
    await expect(page.getByText('Approve or block above to continue')).toHaveCount(0)
    const caretStillInComposer = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'Message input',
    )
    expect(caretStillInComposer).toBe(true)

    // The payload stays behind Details rather than in any label, in the ribbon and in the durable
    // transcript row alike.
    const leaked = await page
      .getByText('Tool: List issues (list_issues)')
      .evaluateAll((nodes) =>
        nodes.map((node) => `${node.tagName}.${node.className}`.slice(0, 160)),
      )
    expect(leaked, `payload visible in: ${leaked.join(' | ')}`).toEqual([])
    await ribbon.getByRole('button', { name: /Details/ }).click()
    await expect(ribbon.getByText(/Tool: List issues \(list_issues\)/)).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('notifications float clear of the composer, most severe first', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-access-notifications-')

  try {
    const { mainWindow, sessionId } = await openSeededSession(app)
    const page = mainWindow.page

    await app.emitAgentEvent(notification(sessionId, 'error', 'Could not reach api.github.com'))
    await app.emitAgentEvent(notification(sessionId, 'info', 'Ponytail loaded: full'))

    const stack = page.getByLabel('Agent notifications')
    await expect(stack).toBeVisible()
    await expect(stack).toHaveAttribute('aria-live', 'polite')
    await expect(stack.getByText('Could not reach api.github.com')).toBeVisible()

    // The error outranks the later informational notice, so it is the frontmost card.
    const labels = await stack.locator('[data-notification-level]').evaluateAll((cards) =>
      cards.map((card) => card.getAttribute('data-notification-level')),
    )
    expect(labels[0]).toBe('error')

    // The stack is not inside the composer.
    const insideComposer = await page.evaluate(() => {
      const notifications = document.querySelector('[aria-label="Agent notifications"]')
      const composer = document.querySelector('[data-chat-composer-form="true"]')
      return notifications !== null && composer !== null && composer.contains(notifications)
    })
    expect(insideComposer).toBe(false)

    // The informational notice leaves on its own; the error stays until dismissed.
    await expect(stack.getByText('Ponytail loaded: full')).toHaveCount(0, { timeout: 15_000 })
    await expect(stack.getByText('Could not reach api.github.com')).toBeVisible()
  } finally {
    await app.cleanup()
  }
})
