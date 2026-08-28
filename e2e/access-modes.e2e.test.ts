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

test('the composer access control names the mode in force, in the documented vocabulary', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-access-modes-')

  try {
    const { mainWindow } = await openSeededSession(app)
    const page = mainWindow.page
    const trigger = page.getByRole('button', { name: 'Session access mode: YOLO' })

    const header = page.locator('header')
    const headerIdentity = header.locator('[data-qa="header-identity"]')
    const headerActions = header.locator('[data-qa="header-actions"]')
    const headerTitle = header.locator('[data-qa="header-session-title"]')
    const headerLayout = await Promise.all([
      header.boundingBox(),
      headerIdentity.boundingBox(),
      headerActions.boundingBox(),
      headerTitle.boundingBox(),
    ])
    const [headerBox, identityBox, actionsBox, titleBox] = headerLayout

    expect(headerBox).not.toBeNull()
    expect(identityBox).not.toBeNull()
    expect(actionsBox).not.toBeNull()
    expect(titleBox).not.toBeNull()
    if (headerBox && identityBox && actionsBox && titleBox) {
      expect(titleBox.height).toBeLessThanOrEqual(20)
      expect(identityBox.x + identityBox.width).toBeLessThanOrEqual(actionsBox.x)
      expect(identityBox.y).toBeGreaterThanOrEqual(headerBox.y)
      expect(identityBox.y + identityBox.height).toBeLessThanOrEqual(
        headerBox.y + headerBox.height,
      )
    }

    await expect(trigger).toBeVisible()
    await trigger.click()
    // The compact trigger stays short while the menu uses the canonical documented vocabulary.
    await expect(
      page.getByRole('menuitemradio', { exact: true, name: 'YOLO (Full Access)' }),
    ).toBeVisible()
    await expect(
      page.getByRole('menuitemradio', { exact: true, name: 'Ask for Approval' }),
    ).toBeVisible()

    await expect(
      page.getByRole('menuitemradio', { exact: true, name: 'YOLO (Full Access)' }),
    ).toBeChecked()
    await expect(page.getByRole('menuitemradio')).toHaveCount(2)
    await expect(page.getByText(/Default/)).toHaveCount(0)

    await page.keyboard.press('Escape')
    await app.resizeMainWindow(720, 700)
    const toolbar = page.getByTestId('composer-toolbar')
    const toolbarActions = page.getByTestId('composer-toolbar-actions')
    const sendButton = page.getByRole('button', { name: 'Send message' })
    await expect(toolbar).toBeVisible()
    await expect(toolbarActions).toBeVisible()
    await expect(sendButton).toBeVisible()
    await expect
      .poll(async () => {
        const [toolbarBox, toolbarActionsBox, sendButtonBox] = await Promise.all([
          toolbar.boundingBox(),
          toolbarActions.boundingBox(),
          sendButton.boundingBox(),
        ])
        if (!toolbarBox || !toolbarActionsBox || !sendButtonBox) return false
        return (
          toolbarActionsBox.x >= toolbarBox.x &&
          toolbarActionsBox.x + toolbarActionsBox.width <= toolbarBox.x + toolbarBox.width &&
          sendButtonBox.x >= toolbarBox.x &&
          sendButtonBox.x + sendButtonBox.width <= toolbarBox.x + toolbarBox.width
        )
      })
      .toBe(true)
  } finally {
    await app.cleanup()
  }
})

test('worktree setup becomes a compact expandable trace before agent streaming', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-e2e-worktree-launch-')

  try {
    const { mainWindow, sessionId } = await openSeededSession(app)
    const page = mainWindow.page

    await app.emitWorktreeLaunch({
      sessionId,
      launch: {
        status: 'running',
        stage: 'checking-out-files',
        startedAt: 1,
        updatedAt: 2,
        details: ['Preparing the session worktree', 'Creating session-a-worktree from main'],
      },
    })

    const preflight = page.getByRole('region', { name: 'Creating a worktree' })
    await expect(preflight).toBeVisible()
    await expect(preflight.getByText('Preparing workspace')).toBeVisible()
    await expect(preflight.locator('span').filter({ hasText: /^Checking out files$/u })).toBeVisible()
    await expect(preflight.getByRole('button', { name: 'Work locally' })).toBeVisible()
    await expect(preflight.getByRole('button', { name: 'Cancel' })).toBeVisible()

    await app.emitWorktreeLaunch({
      sessionId,
      launch: {
        status: 'complete',
        stage: 'starting-task',
        startedAt: 1,
        updatedAt: 3,
        details: [
          'Preparing the session worktree',
          'Creating session-a-worktree from main',
          'Created session-a-worktree from main',
          'Starting the task in the new worktree',
        ],
      },
    })

    await expect(preflight).toHaveCount(0)
    const trace = page.getByRole('button', { name: /Worktree created/ })
    await expect(trace).toBeVisible()
    await trace.click()
    await expect(page.getByText('Created session-a-worktree from main')).toBeVisible()
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
    await expect(stack.getByText('Could not reach api.github.com')).toBeVisible()

    // The announcement comes from a region that already existed, which is what makes it audible. A
    // live region added with its content is not announced.
    const announcer = page.locator('[role="status"][aria-live="polite"]').first()
    await expect(announcer).toHaveText('Could not reach api.github.com')

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
