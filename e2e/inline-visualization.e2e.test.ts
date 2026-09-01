import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const THREAD_TITLE = 'Inline Visualization Security'
const FRAME_TITLE = 'Interactive security probe'
const SOURCE_NAME = 'interactive-security-probe.html'

function visualizationSource() {
  return `
<main class="card">
  <h2>Visualization security probe</h2>
  <i data-lucide="activity" aria-hidden="true"></i>
  <button id="counter" class="btn btn-primary" type="button">Count 0</button>
  <button id="navigate" class="btn" type="button" data-tooltip="Sandbox navigation probe">Attempt navigation</button>
  <output id="status" aria-live="polite"></output>
</main>
<script>
  const status = document.querySelector('#status');
  const probe = (read) => { try { return read(); } catch { return 'blocked'; } };
  status.dataset.node = typeof process;
  status.dataset.require = typeof require;
  status.dataset.api = typeof window.api;
  status.dataset.parentDocument = probe(() => typeof parent.document.body);
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
  document.querySelector('#counter').addEventListener('click', (event) => {
    count += 1;
    event.currentTarget.textContent = 'Count ' + count;
    const existing = document.querySelector('#expansion');
    if (existing) {
      existing.remove();
      return;
    }
    const expansion = document.createElement('div');
    expansion.id = 'expansion';
    expansion.style.height = '480px';
    expansion.textContent = 'Local state retained';
    document.querySelector('main').appendChild(expansion);
  });
  document.querySelector('#navigate').addEventListener('click', () => {
    location.assign('https://example.com/escape-attempt');
  });
</script>`
}

async function expectSecureInteractiveVisualization(app: OpenWaggleApp) {
  const page = app.window()
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
  await expect(status).toHaveAttribute('data-remote-network', 'blocked')
  await expect(status).toHaveAttribute('data-relative-resource', 'blocked')
  await expect(status).toHaveAttribute('data-capability-attack', 'sent')
  await expect(iframe).not.toHaveCSS('height', '9999px')
  const navigationButton = frame.getByRole('button', { name: 'Attempt navigation' })
  // The hidden Electron window cannot acquire OS focus, so exercise the same
  // bubbling focus event that keyboard navigation delivers in a focused app.
  await navigationButton.dispatchEvent('focusin')
  await expect(frame.getByRole('tooltip')).toHaveText('Sandbox navigation probe')
  await expect(navigationButton).toHaveAttribute('aria-describedby', /^openwaggle-tooltip-/u)

  const heightBefore = await iframe.evaluate((element) => element.getBoundingClientRect().height)
  await frame.getByRole('button', { name: 'Count 0' }).evaluate((element: HTMLElement) => {
    element.click()
  })
  await expect(frame.getByRole('button', { name: 'Count 1' })).toBeVisible()
  await expect(frame.getByText('Local state retained')).toBeVisible()
  await expect(async () => {
    const heightAfter = await iframe.evaluate((element) => element.getBoundingClientRect().height)
    expect(heightAfter).toBeGreaterThan(heightBefore)
  }).toPass()
  const heightExpanded = await iframe.evaluate((element) => element.getBoundingClientRect().height)
  await frame.getByRole('button', { name: 'Count 1' }).evaluate((element: HTMLElement) => {
    element.click()
  })
  await expect(frame.getByRole('button', { name: 'Count 2' })).toBeVisible()
  await expect(frame.getByText('Local state retained')).toHaveCount(0)
  await expect(async () => {
    const heightCollapsed = await iframe.evaluate((element) => element.getBoundingClientRect().height)
    expect(heightCollapsed).toBeLessThan(heightExpanded)
  }).toPass()

  await frame.getByRole('button', { name: 'Attempt navigation' }).evaluate((element: HTMLElement) => {
    element.click()
  })
  await expect(page).toHaveURL(/^openwaggle:\/\/app\//u)
  await expect(page.getByRole('alert')).toContainText('visualization could not be loaded')
  await expect(iframe).toHaveCount(0)
}

async function openVisualizationThread(app: OpenWaggleApp) {
  const thread = app.mainWindow().threadItem(THREAD_TITLE)
  await expect(thread).toBeVisible()
  await thread.click({ noWaitAfter: true })
}

test('renders a persistent interactive visualization inside the isolated Electron frame', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-inline-visualization-e2e-')

  try {
    const sourcePath = path.join(app.userDataDir, SOURCE_NAME)
    await fs.writeFile(sourcePath, visualizationSource(), 'utf8')
    const reference = `visualize${JSON.stringify({ path: sourcePath, title: FRAME_TITLE, mode: 'wide' })}`
    await seedSingleSession(app.userDataDir, {
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
    await openVisualizationThread(app)
    await expectSecureInteractiveVisualization(app)

    await app.restart()
    await openVisualizationThread(app)
    await expectSecureInteractiveVisualization(app)
  } finally {
    await app.cleanup()
  }
})
