import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@playwright/test'
import Database from 'better-sqlite3'
import { getDatabasePath, seedSingleSession } from './support/session-fixtures'
import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import { prepareEssentials, sidebar, TIGHT_PAD_PX } from './website-screenshot-essentials-setup'
import { MINUTE_MS } from './website-screenshot-essentials-tool-rows'
import { type CaptureContext, openSession, UI_TIMEOUT_MS, waitForUi } from './website-screenshot-ui'

/**
 * An inline visualization in a jotter session, stored the way the visualize skill stores one: an
 * HTML fragment in the session's visualization directory (`<userData>/visualizations/<session>`),
 * and a `visualize{...}` reference on its own line of the assistant's reply. Wide mode, because
 * only wide visualizations have Expand. Seeded by the first visualization capture, after every
 * other jotter capture, so the extra sidebar row changes no earlier image.
 */

export const VISUALIZATION_SESSION_TITLE = 'Chart the upload retry fix'
const VISUALIZATION_FILE = 'jotter-upload-retries.html'
const VISUALIZATION_TITLE = 'jotter upload retries'
const PROMPT = 'Show me how the 4xx retry fix changed upload retries in jotter.'
const REPLY_BEFORE = 'Upload retries over the last 7 days, before and after the fix:'
const REPLY_AFTER =
  'Client errors no longer retry. 429 and 5xx responses still do, so p95 upload time fell from 9.8 s to 2.1 s.'
const EXPANDED_BACKDROP_PX = 48
/** How long ago the prompt and the reply were sent. */
const ASKED_AGO_MS = 3 * MINUTE_MS
const REPLIED_AGO_MS = 2 * MINUTE_MS
const ASSISTANT_NODE_ID = 'website-visualization-assistant'
/** The marker the capture waits for inside the frame. */
const FRAME_READY_TEXT = 'After the fix'

/**
 * Three small panels side by side on one scale, the case the skill gives for wide mode. Plain
 * SVG drawn from each panel's measured width with the host's theme tokens, no CDN.
 */
const FRAGMENT = `<div id="jotter-upload-retries">
<style>
#jotter-upload-retries { padding: 16px 16px 8px; }
#jotter-upload-retries .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; }
#jotter-upload-retries h3 { margin: 0 0 8px; }
#jotter-upload-retries svg { display: block; width: 100%; }
#jotter-upload-retries svg text { fill: var(--foreground); font-size: 12px; }
#jotter-upload-retries svg .muted { fill: var(--muted-foreground); }
#jotter-upload-retries svg .frame { fill: none; stroke: var(--border); }
</style>
<div class="panels">
  <section><h3>Before the fix</h3><div class="chart" data-series="before" aria-label="Retries by response status before the fix"></div></section>
  <section><h3>After the fix</h3><div class="chart" data-series="after" aria-label="Retries by response status after the fix"></div></section>
  <section><h3>p95 upload time</h3><div class="chart" data-series="p95" aria-label="p95 upload time before and after the fix"></div></section>
</div>
</div>
<script>
(() => {
  const root = document.getElementById('jotter-upload-retries');
  const retries = {
    before: [['400', 412], ['404', 96], ['429', 58], ['500', 31], ['503', 22]],
    after: [['400', 0], ['404', 0], ['429', 55], ['500', 29], ['503', 24]],
  };
  const p95 = [['Before', 9.8], ['After', 2.1]];
  const height = 220;
  const left = 44;
  const bottom = 28;
  const top = 18;
  function draw(container) {
    const width = Math.max(220, container.clientWidth);
    const series = container.dataset.series;
    const data = series === 'p95' ? p95 : retries[series];
    const max = series === 'p95' ? 12 : 450;
    const unit = series === 'p95' ? 's' : 'retries';
    const plotWidth = width - left - 8;
    const plotHeight = height - top - bottom;
    const band = plotWidth / data.length;
    const bar = Math.min(36, band * 0.6);
    const ticks = series === 'p95' ? [0, 4, 8, 12] : [0, 150, 300, 450];
    const parts = ['<svg viewBox="0 0 ' + width + ' ' + height + '" role="img">'];
    parts.push('<rect class="frame" x="' + left + '" y="' + top + '" width="' + plotWidth + '" height="' + plotHeight + '"/>');
    for (const tick of ticks) {
      const y = top + plotHeight - (tick / max) * plotHeight;
      parts.push('<text class="muted" x="' + (left - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + tick + '</text>');
    }
    data.forEach(([label, value], index) => {
      const x = left + band * index + (band - bar) / 2;
      const barHeight = (value / max) * plotHeight;
      const y = top + plotHeight - barHeight;
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + bar + '" height="' + barHeight + '" rx="3" fill="var(--viz-series-1)"><title>' + label + ': ' + value + ' ' + unit + '</title></rect>');
      parts.push('<text x="' + (x + bar / 2) + '" y="' + (y - 4) + '" text-anchor="middle">' + value + '</text>');
      parts.push('<text class="muted" x="' + (x + bar / 2) + '" y="' + (height - 10) + '" text-anchor="middle">' + label + '</text>');
    });
    parts.push('</svg>');
    container.innerHTML = parts.join('');
  }
  const charts = [...root.querySelectorAll('.chart')];
  const observer = new ResizeObserver(() => charts.forEach(draw));
  charts.forEach((chart) => { draw(chart); observer.observe(chart); });
  window.openai?.setVisualizationState?.(null);
})();
</script>
`

const seeded = new WeakMap<CaptureContext['page'], Promise<void>>()

async function seedVisualizationSession(context: CaptureContext) {
  const { project } = await prepareEssentials(context)
  const now = Date.now()
  // The reference names the file by its absolute path in the session's directory, which needs
  // the session's id, so the reply's text is written once the session exists.
  const sessionId = await seedSingleSession(context.userDataDir, {
    title: VISUALIZATION_SESSION_TITLE,
    projectPath: project.projectPath,
    updatedAt: now - REPLIED_AGO_MS,
    messages: [
      {
        id: 'website-visualization-user',
        role: 'user',
        createdAt: now - ASKED_AGO_MS,
        parts: [{ type: 'text', text: PROMPT }],
      },
      {
        id: ASSISTANT_NODE_ID,
        role: 'assistant',
        model: 'gpt-5.4',
        createdAt: now - REPLIED_AGO_MS,
        parts: [{ type: 'text', text: REPLY_BEFORE }],
      },
    ],
  })
  const directory = path.join(context.userDataDir, 'visualizations', sessionId)
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, VISUALIZATION_FILE)
  await fs.writeFile(file, FRAGMENT)
  const reference = `visualize${JSON.stringify({ path: file, title: VISUALIZATION_TITLE, mode: 'wide' })}`
  const text = [REPLY_BEFORE, '', reference, '', REPLY_AFTER].join('\n')
  const database = new Database(getDatabasePath(context.userDataDir))
  try {
    database
      .prepare('UPDATE session_nodes SET content_json = ? WHERE id = ?')
      .run(JSON.stringify({ parts: [{ type: 'text', text }], model: 'gpt-5.4' }), ASSISTANT_NODE_ID)
  } finally {
    database.close()
  }
  await context.page.reload()
  await expect(
    sidebar(context.page).getByRole('button', { name: VISUALIZATION_SESSION_TITLE, exact: true }),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

function ensureVisualizationSession(context: CaptureContext) {
  const existing = seeded.get(context.page)
  if (existing) return existing
  const next = seedVisualizationSession(context)
  seeded.set(context.page, next)
  return next
}

async function openVisualization(context: CaptureContext) {
  const { page } = context
  await ensureVisualizationSession(context)
  await openSession(page, VISUALIZATION_SESSION_TITLE)
  const surface = page.locator(`section[data-visualization-path$="${VISUALIZATION_FILE}"]`)
  await surface
    .frameLocator('iframe')
    .getByText(FRAME_READY_TEXT)
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  return surface
}

/** The reply with its wide visualization inline in the transcript, between its two sentences. */
export async function captureVisualizationInline(context: CaptureContext) {
  const { page } = context
  const surface = await openVisualization(context)
  const log = page.getByRole('log', { name: 'Chat messages' })
  const before = log.getByText(REPLY_BEFORE)
  const after = log.getByText(REPLY_AFTER)
  // Close under the last sentence: the message's action icons sit just below it.
  await shootRegion(context, 'visualization-inline.png', async () => {
    const box = unionRegion(
      [await regionOf(before), await regionOf(surface), await regionOf(after)],
      CROP_MARGIN_PX,
    )
    return { ...box, height: box.height - CROP_MARGIN_PX + TIGHT_PAD_PX }
  })
}

/** The same visualization opened with Expand, over the dimmed window. */
export async function captureVisualizationExpanded(context: CaptureContext) {
  const { page } = context
  const surface = await openVisualization(context)
  await surface.getByRole('button', { name: 'Expand visualization' }).click()
  const dialog = page.getByRole('dialog', { name: VISUALIZATION_TITLE })
  await dialog.waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  // The expanded view and a margin of the backdrop around it; the rest of the window is the
  // same dark backdrop.
  await shootRegion(
    context,
    'visualization-expanded.png',
    async () => unionRegion([await regionOf(dialog)], EXPANDED_BACKDROP_PX),
    { keepFocus: true },
  )
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
}
