import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const THREAD_TITLE = 'Inline Visualization Security'
const FRAME_TITLE = 'Interactive security probe'
const SOURCE_NAME = 'interactive-security-probe.html'
const BLOCKING_FRAME_TITLE = 'Blocking security probe'
const BLOCKING_SOURCE_NAME = 'blocking-security-probe.html'
const RESOURCE_FRAME_TITLE = 'Resource budget security probe'
const RESOURCE_SOURCE_NAME = 'resource-budget-security-probe.html'
const CROSS_PROCESS_UI_TIMEOUT_MS = 15_000

function visualizationSource() {
  return `
<main class="card">
  <h2>Visualization security probe</h2>
  <i data-lucide="activity" aria-hidden="true"></i>
  <div class="nav nav-pills" role="tablist" aria-label="Probe views">
    <button class="nav-link active" id="summary-tab" role="tab" aria-controls="summary-panel" aria-selected="true" type="button">Summary</button>
    <button class="nav-link" id="details-tab" role="tab" aria-controls="details-panel" aria-selected="false" type="button">Details</button>
  </div>
  <div id="summary-panel" role="tabpanel" aria-labelledby="summary-tab">Summary panel</div>
  <div id="details-panel" role="tabpanel" aria-labelledby="details-tab" hidden>Details panel</div>
  <button id="counter" class="btn btn-primary" type="button">Count 0</button>
  <button id="follow-up" class="btn" type="button">Ask agent about count 0</button>
  <button id="synthetic-host-message" class="btn" type="button">Forge host message</button>
  <span id="navigation-description" hidden>Navigation remains inside the sandbox.</span>
  <button id="navigate" class="btn" type="button" aria-describedby="navigation-description" data-tooltip="Sandbox navigation probe">Attempt navigation</button>
  <button id="touch-tooltip" class="btn" type="button" data-tooltip="Touch tooltip probe">Touch tooltip</button>
  <button id="touch-redraw" class="btn" type="button" data-tooltip="Removed tooltip probe">Redraw touch target</button>
  <output id="status" aria-live="polite"></output>
</main>
<script>
  const status = document.querySelector('#status');
  const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  status.dataset.reducedMotion = reducedMotionQuery.matches ? 'reduced' : 'full';
  reducedMotionQuery.addEventListener('change', (event) => {
    status.dataset.reducedMotion = event.matches ? 'reduced' : 'full';
  });
  const probe = (read) => { try { return read(); } catch { return 'blocked'; } };
  status.dataset.node = typeof process;
  status.dataset.require = typeof require;
  status.dataset.api = typeof window.api;
  status.dataset.parentDocument = probe(() => typeof parent.document.body);
  try {
    const workerUrl = URL.createObjectURL(new Blob(["postMessage('started')"], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const finishWorkerProbe = (result) => {
      if (status.dataset.worker) return;
      status.dataset.worker = result;
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };
    worker.addEventListener('message', () => finishWorkerProbe('allowed'), { once: true });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      finishWorkerProbe('blocked');
    }, { once: true });
    setTimeout(() => finishWorkerProbe('blocked'), 1_000);
  } catch {
    status.dataset.worker = 'blocked';
  }
  const forgedEarlyCapability = 'fragment-first-capability';
  parent.postMessage({ type: 'openwaggle:inline-visualization:ready', capability: forgedEarlyCapability }, '*');
  parent.postMessage({ type: 'openwaggle:inline-visualization:resize', capability: forgedEarlyCapability, height: 9999 }, '*');
  status.dataset.earlyCapabilityAttack = 'sent';
  try {
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true },
    });
    window.openai.sendFollowUpMessage({
      prompt: 'Untrusted automatic follow-up',
      title: 'Activation spoof probe',
    }).then((accepted) => {
      status.dataset.activationAttack = accepted ? 'accepted' : 'blocked';
    });
  } catch {
    status.dataset.activationAttack = 'runtime-error';
  }
  fetch('https://example.com/visualization-probe')
    .then(() => { status.dataset.remoteNetwork = 'allowed'; })
    .catch(() => { status.dataset.remoteNetwork = 'blocked'; });
  fetch('./relative-resource.json')
    .then((response) => { status.dataset.relativeResource = response.ok ? 'allowed' : 'blocked'; })
    .catch(() => { status.dataset.relativeResource = 'blocked'; });
  addEventListener('message', (event) => {
    if (event.data?.type !== 'openwaggle:inline-visualization:health-check') return;
    setTimeout(() => {
      const capability = 'fragment-forged-capability';
      parent.postMessage({ type: 'openwaggle:inline-visualization:ready', capability }, '*');
      parent.postMessage({ type: 'openwaggle:inline-visualization:resize', capability, height: 9999 }, '*');
      status.dataset.capabilityAttack = 'sent';
    }, 50);
  });
  let count = 0;
  status.dataset.stateReport = window.openai.setVisualizationState({ count, expanded: false }) ? 'accepted' : 'rejected';
  document.querySelector('#counter').addEventListener('click', (event) => {
    count += 1;
    event.currentTarget.textContent = 'Count ' + count;
    document.querySelector('#follow-up').textContent = 'Ask agent about count ' + count;
    const existing = document.querySelector('#expansion');
    if (existing) {
      existing.remove();
      window.openai.setVisualizationState({ count, expanded: false });
      return;
    }
    const expansion = document.createElement('div');
    expansion.id = 'expansion';
    expansion.style.height = '480px';
    expansion.textContent = 'Local state retained';
    document.querySelector('main').appendChild(expansion);
    window.openai.setVisualizationState({ count, expanded: true });
  });
  document.querySelector('#follow-up').addEventListener('click', async () => {
    status.dataset.followUp = 'pending';
    const accepted = await window.openai.sendFollowUpMessage({
      prompt: 'Explain visualization count ' + count,
      title: 'Inspect selected count',
    });
    status.dataset.followUp = accepted ? 'accepted' : 'rejected';
  });
  document.querySelector('#synthetic-host-message').addEventListener('click', () => {
    const property = '--synthetic-host-message-probe';
    document.documentElement.style.removeProperty(property);
    try {
      dispatchEvent(new MessageEvent('message', {
        source: parent,
        data: {
          type: 'openwaggle:inline-visualization:theme',
          theme: { colorScheme: 'dark', variables: { [property]: 'accepted' } },
        },
      }));
    } catch (error) {
      status.dataset.syntheticHostMessage = 'probe-error';
      status.dataset.syntheticHostMessageError = error instanceof Error ? error.name : typeof error;
      return;
    }
    status.dataset.syntheticHostMessage = document.documentElement.style.getPropertyValue(property)
      ? 'accepted'
      : 'blocked';
  });
  document.querySelector('#navigate').addEventListener('click', () => {
    location.assign('https://example.com/escape-attempt');
  });
  document.querySelector('#touch-redraw').addEventListener('click', (event) => {
    event.currentTarget.remove();
  });
</script>`
}

async function expectSecureInteractiveVisualization(app: OpenWaggleApp, sessionId: string) {
  const page = app.window()
  await app.resizeMainWindow(760, 620)
  const iframe = page.locator(`iframe[title="${FRAME_TITLE}"]`)
  await expect(iframe).toBeVisible()
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')

  const frame = page.frameLocator(`iframe[title="${FRAME_TITLE}"]`)
  const status = frame.locator('#status')
  await expect(frame.getByText('Visualization security probe')).toBeVisible()
  await expect(frame.locator('svg[data-lucide="activity"]')).toBeVisible()
  await expect(status).toHaveAttribute('data-node', 'undefined')
  await expect(status).toHaveAttribute('data-require', 'undefined')
  await expect(status).toHaveAttribute('data-api', 'undefined')
  await expect(status).toHaveAttribute('data-parent-document', 'blocked')
  await expect(status).toHaveAttribute('data-worker', 'blocked')
  await expect(status).toHaveAttribute('data-activation-attack', 'blocked')
  await expect(status).toHaveAttribute('data-remote-network', 'blocked')
  await expect(status).toHaveAttribute('data-relative-resource', 'blocked')
  await expect(status).toHaveAttribute('data-capability-attack', 'sent')
  await expect(status).toHaveAttribute('data-early-capability-attack', 'sent')
  await expect(status).toHaveAttribute('data-state-report', 'accepted')
  await expect(status).toHaveAttribute('data-reduced-motion', 'reduced')
  await expect(iframe).not.toHaveCSS('height', '9999px')
  // This security probe does not require trusted activation. A DOM click avoids the hidden-window
  // pointer delivery differences exercised by the Linux and Windows merge-queue jobs.
  await frame
    .getByRole('button', { name: 'Forge host message' })
    .evaluate((element: HTMLButtonElement) => {
      element.click()
    })
  await expect(status).toHaveAttribute('data-synthetic-host-message', 'blocked')
  const summaryTab = frame.getByRole('tab', { name: 'Summary' })
  const detailsTab = frame.getByRole('tab', { name: 'Details' })
  await expect(frame.getByRole('tabpanel', { name: 'Summary' })).toBeVisible()
  await expect(frame.getByRole('tabpanel', { name: 'Details' })).toBeHidden()
  if (process.platform === 'darwin') await detailsTab.click()
  else {
    // Hidden Linux and Windows Electron windows do not deliver iframe pointer input consistently.
    // A DOM click still exercises the visualization runtime's delegated tab interaction there.
    await detailsTab.evaluate((element: HTMLButtonElement) => {
      element.click()
    })
  }
  await expect(detailsTab).toHaveAttribute('aria-selected', 'true')
  await expect(frame.getByRole('tabpanel', { name: 'Details' })).toBeVisible()
  await detailsTab.press('ArrowLeft')
  await expect(summaryTab).toHaveAttribute('aria-selected', 'true')
  await expect(summaryTab).toBeFocused()
  const followUpButton = frame.getByRole('button', { name: 'Ask agent about count 0' })
  if (process.platform === 'darwin') await followUpButton.click()
  else await followUpButton.press('Enter')
  await expect(status).toHaveAttribute('data-follow-up', 'accepted')
  await expect
    .poll(() => app.readAgentSendProbe(), { timeout: CROSS_PROCESS_UI_TIMEOUT_MS })
    .toMatchObject({
      sessionId,
      payload: {
        text: 'Explain visualization count 0',
        visualizationContext: {
          sourcePath: expect.stringContaining(SOURCE_NAME),
          title: FRAME_TITLE,
          state: { count: 0, expanded: false },
        },
      },
    })
  await expect(iframe).toBeVisible()
  const navigationButton = frame.getByRole('button', { name: 'Attempt navigation' })
  // The hidden Electron window cannot acquire OS focus, so exercise the same
  // bubbling focus event that keyboard navigation delivers in a focused app.
  await navigationButton.dispatchEvent('focusin')
  await expect(frame.getByRole('tooltip')).toHaveText('Sandbox navigation probe')
  await expect(navigationButton).toHaveAttribute(
    'aria-describedby',
    /^navigation-description openwaggle-tooltip-/u,
  )
  await navigationButton.dispatchEvent('focusout')
  await expect(navigationButton).toHaveAttribute('aria-describedby', 'navigation-description')

  const touchTooltipButton = frame.getByRole('button', { name: 'Touch tooltip' })
  await touchTooltipButton.dispatchEvent('pointerdown', { pointerType: 'touch' })
  await touchTooltipButton.dispatchEvent('click', { detail: 1 })
  await expect(frame.getByRole('tooltip')).toHaveText('Touch tooltip probe')
  await touchTooltipButton.dispatchEvent('pointerdown', { pointerType: 'touch' })
  await touchTooltipButton.dispatchEvent('click', { detail: 1 })
  await expect(frame.getByRole('tooltip')).toHaveCount(0)

  const redrawTooltipButton = frame.getByRole('button', { name: 'Redraw touch target' })
  await redrawTooltipButton.dispatchEvent('pointerdown', { pointerType: 'touch' })
  await redrawTooltipButton.dispatchEvent('click', { detail: 1 })
  await expect(redrawTooltipButton).toHaveCount(0)
  await expect(frame.getByRole('tooltip')).toHaveCount(0)

  await app.resizeMainWindow(1440, 900)
  await page.getByRole('button', { name: 'Expand visualization' }).click()
  const largeFocusLayer = page.locator('[data-visualization-focus-layer="true"]')
  const largeDialog = page.getByRole('dialog', { name: FRAME_TITLE })
  await expect(largeFocusLayer).toBeVisible()
  await expect(largeDialog).toBeVisible()
  await largeDialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  const largeViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const largeDialogBounds = await largeDialog.boundingBox()
  expect(largeDialogBounds).not.toBeNull()
  expect(largeDialogBounds?.width).toBeLessThan(largeViewport.width - 200)
  expect(
    Math.abs(
      (largeDialogBounds?.x ?? 0) * 2 +
        (largeDialogBounds?.width ?? 0) -
        largeViewport.width,
    ),
  ).toBeLessThanOrEqual(2)
  expect(
    Math.abs(
      (largeDialogBounds?.y ?? 0) * 2 +
        (largeDialogBounds?.height ?? 0) -
        largeViewport.height,
    ),
  ).toBeLessThanOrEqual(2)
  await app.captureEvidence('openwaggle-inline-visualization-centered-dialog')

  const closeButton = page.getByRole('button', { name: 'Close expanded visualization' })
  const closeBounds = await closeButton.boundingBox()
  expect(closeBounds?.width).toBeGreaterThanOrEqual(44)
  expect(closeBounds?.height).toBeGreaterThanOrEqual(44)
  await page.mouse.click((closeBounds?.x ?? 0) + 4, (closeBounds?.y ?? 0) + 4)
  await expect(largeFocusLayer).toHaveCount(0)

  await app.resizeMainWindow(760, 620)
  const heightBefore = await iframe.evaluate((element) => element.getBoundingClientRect().height)
  await frame
    .getByRole('button', { name: 'Count 0', exact: true })
    .evaluate((element: HTMLElement) => {
      element.click()
    })
  await expect(frame.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible()
  await expect(frame.getByText('Local state retained')).toBeVisible()
  await expect(async () => {
    const heightAfter = await iframe.evaluate((element) => element.getBoundingClientRect().height)
    expect(heightAfter).toBeGreaterThan(heightBefore)
  }).toPass()

  await page.getByRole('button', { name: 'Expand visualization' }).click()
  const focusLayer = page.locator('[data-visualization-focus-layer="true"]')
  const dialog = page.getByRole('dialog', { name: FRAME_TITLE })
  await expect(focusLayer).toBeVisible()
  await expect(dialog).toBeVisible()
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  await expect(frame.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const dialogBounds = await dialog.boundingBox()
  expect(dialogBounds?.x).toBeLessThanOrEqual(24)
  expect(dialogBounds?.width).toBeGreaterThanOrEqual(viewport.width - 48)
  await app.captureEvidence('openwaggle-inline-visualization-expanded')
  expect(
    await page.getByRole('button', { name: 'New session' }).first().evaluate((element) => {
      let current: HTMLElement | null = element
      while (current) {
        if (current.inert) return true
        current = current.parentElement
      }
      return false
    }),
  ).toBe(true)
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await expect(focusLayer).toHaveCount(0)
  await expect(page.getByRole('region', { name: FRAME_TITLE })).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible()
  const feedback = 'The selected visualization state should keep the expanded section.'
  await app.installSessionDetailSnapshotProbe({
    sessionId,
    detail: {
      id: sessionId,
      title: THREAD_TITLE,
      projectPath: app.userDataDir,
      piSessionId: 'replacement-pi-session',
      messages: [
        {
          id: 'replacement-user-message',
          role: 'user',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: feedback }],
        },
        {
          id: 'replacement-assistant-message',
          role: 'assistant',
          createdAt: Date.now() + 1,
          parts: [{ type: 'text', text: 'The selected stage is sandbox.' }],
        },
      ],
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() + 2,
    },
  })
  await app.mainWindow().messageInput().fill(feedback)
  await app.mainWindow().submitComposer()
  await expect
    .poll(() => app.readAgentSendProbe(), { timeout: CROSS_PROCESS_UI_TIMEOUT_MS })
    .toMatchObject({
      payload: {
        text: feedback,
        visualizationContext: {
          sourcePath: expect.stringContaining(SOURCE_NAME),
          title: FRAME_TITLE,
          state: { count: 1, expanded: true },
        },
      },
    })
  await expect(page.getByText(feedback, { exact: true })).toBeVisible()
  // The assistant row proves the replacement snapshot hydrated; re-check the user row afterwards.
  await expect(page.getByText('The selected stage is sandbox.', { exact: true })).toBeVisible()
  await expect(page.getByText(feedback, { exact: true })).toBeVisible()
  await expect(async () => {
    const earlierFollowUpBounds = await page
      .getByText('Explain visualization count 0', { exact: true })
      .boundingBox()
    const feedbackBounds = await page.getByText(feedback, { exact: true }).boundingBox()
    const assistantBounds = await page
      .getByText('The selected stage is sandbox.', { exact: true })
      .boundingBox()
    expect(earlierFollowUpBounds?.y).toBeLessThan(feedbackBounds?.y ?? 0)
    expect(feedbackBounds?.y).toBeLessThan(assistantBounds?.y ?? 0)
  }).toPass()
  await app.captureEvidence('openwaggle-inline-visualization-follow-up-retained')
  const heightExpanded = await iframe.evaluate((element) => element.getBoundingClientRect().height)
  await frame
    .getByRole('button', { name: 'Count 1', exact: true })
    .evaluate((element: HTMLElement) => {
      element.click()
    })
  await expect(frame.getByRole('button', { name: 'Count 2', exact: true })).toBeVisible()
  await expect(frame.getByText('Local state retained')).toHaveCount(0)
  await expect(async () => {
    const heightCollapsed = await iframe.evaluate((element) => element.getBoundingClientRect().height)
    expect(heightCollapsed).toBeLessThan(heightExpanded)
  }).toPass()

  await frame.getByRole('button', { name: 'Attempt navigation' }).evaluate((element: HTMLElement) => {
    element.click()
  })
  await expect(page).toHaveURL(/^openwaggle:\/\/app\//u)
  await expect(page.getByRole('alert')).toContainText('visualization could not be loaded', {
    timeout: 10_000,
  })
  await expect(iframe).toHaveCount(0)
}

async function expectVisualizeSlashCommand(app: OpenWaggleApp) {
  const page = app.window()
  const input = app.mainWindow().messageInput()
  await input.fill('/vis')
  const menu = page.getByRole('menu', { name: 'Slash command menu' })
  await expect(menu).toBeVisible()
  const visualize = menu.getByRole('menuitem', { name: /Visualize/u })
  await expect(visualize).toContainText('/visualize')
  await input.press('Enter')
  await expect(input.locator('[title="/visualize"]')).toContainText('Visualize', {
    timeout: CROSS_PROCESS_UI_TIMEOUT_MS,
  })
}

async function openVisualizationThread(app: OpenWaggleApp) {
  const thread = app.mainWindow().threadItem(THREAD_TITLE)
  await expect(thread).toBeVisible()
  await thread.click({ noWaitAfter: true })
}

test('renders a persistent interactive visualization inside the isolated Electron frame', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-inline-visualization-e2e-')

  try {
    const page = app.window()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()
    await page.getByRole('switch', { name: 'Reduce motion' }).click()
    await expect
      .poll(async () => {
        const settings = await page.evaluate(() => window.api.getSettings())
        return settings.appearancePreferences.motion
      })
      .toBe('reduced')

    const sourcePath = path.join(app.userDataDir, SOURCE_NAME)
    await fs.writeFile(sourcePath, visualizationSource(), 'utf8')
    const reference = `visualize${JSON.stringify({ path: sourcePath, title: FRAME_TITLE, mode: 'wide' })}`
    const sessionId = await seedSingleSession(app.userDataDir, {
      title: THREAD_TITLE,
      projectPath: app.userDataDir,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'visualization-assistant-message',
          role: 'assistant',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: reference }],
        },
      ],
    })

    await app.restart()
    await app.installAgentSendProbe()
    await app.confirmNativeDialogs()
    await openVisualizationThread(app)
    await expectVisualizeSlashCommand(app)
    await expectSecureInteractiveVisualization(app, sessionId)

    await app.restart()
    await app.installAgentSendProbe()
    await app.confirmNativeDialogs()
    await openVisualizationThread(app)
    await expectSecureInteractiveVisualization(app, sessionId)
  } finally {
    await app.cleanup()
  }
})

test('terminates a visualization that blocks parsing without freezing OpenWaggle', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-blocking-visualization-e2e-')

  try {
    const sourcePath = path.join(app.userDataDir, BLOCKING_SOURCE_NAME)
    await fs.writeFile(sourcePath, '<script>while (true) {}</script>', 'utf8')
    const reference = `visualize${JSON.stringify({ path: sourcePath, title: BLOCKING_FRAME_TITLE })}`
    await seedSingleSession(app.userDataDir, {
      title: THREAD_TITLE,
      projectPath: app.userDataDir,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'blocking-visualization-assistant-message',
          role: 'assistant',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: reference }],
        },
      ],
    })

    await app.restart()
    await openVisualizationThread(app)

    const page = app.window()
    await expect(page.getByRole('alert')).toContainText('visualization could not be loaded', {
      timeout: 10_000,
    })
    await expect(page.locator(`iframe[title="${BLOCKING_FRAME_TITLE}"]`)).toHaveCount(0)
    await expect(page).toHaveURL(/^openwaggle:\/\/app\//u)
    await expect(app.mainWindow().threadItem(THREAD_TITLE)).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('removes a responsive visualization that exceeds its main-thread budget', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-resource-budget-visualization-e2e-')

  try {
    const sourcePath = path.join(app.userDataDir, RESOURCE_SOURCE_NAME)
    await fs.writeFile(
      sourcePath,
      `<main>Resource budget probe</main><script>
        let runs = 0;
        const burn = () => {
          const startedAt = performance.now();
          while (performance.now() - startedAt < 650) {}
          runs += 1;
          if (runs < 3) setTimeout(burn, 0);
        };
        burn();
      </script>`,
      'utf8',
    )
    const reference = `visualize${JSON.stringify({ path: sourcePath, title: RESOURCE_FRAME_TITLE })}`
    await seedSingleSession(app.userDataDir, {
      title: THREAD_TITLE,
      projectPath: app.userDataDir,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'resource-budget-visualization-assistant-message',
          role: 'assistant',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: reference }],
        },
      ],
    })

    await app.restart()
    await openVisualizationThread(app)

    const page = app.window()
    await expect(page.getByRole('alert')).toContainText('visualization could not be loaded', {
      timeout: 10_000,
    })
    await expect(page.locator(`iframe[title="${RESOURCE_FRAME_TITLE}"]`)).toHaveCount(0)
    await expect(page).toHaveURL(/^openwaggle:\/\/app\//u)
    await expect(app.mainWindow().threadItem(THREAD_TITLE)).toBeVisible()
  } finally {
    await app.cleanup()
  }
})
