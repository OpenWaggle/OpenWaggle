import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import { TIGHT_PAD_PX } from './website-screenshot-essentials-setup'
import { type CaptureContext, openSession, UI_TIMEOUT_MS, waitForUi } from './website-screenshot-ui'
import { ensureVisualizationConversation } from './website-screenshot-visualization-seed'

/**
 * A visualization the user makes a choice in, and the message it sent back. The agent drew the
 * export formats people asked for as tiles to pick from, with a button that asks the agent to
 * plan the picked ones (`window.openai.sendFollowUpMessage`). The transcript already holds that
 * message and the agent's answer, the way it reads after the user confirmed it. The capture
 * clicks the same three tiles, so the image shows the choice the message describes. Each click
 * reports the selection with `setVisualizationState`, as the skill asks. Seeded after the other
 * visualization captures, so the extra jotter row changes no earlier image
 * (`website-screenshot-visualization-seed.ts`).
 */

const CHOICE_SESSION_TITLE = 'Pick the export formats for 1.0'
const CHOICE_FILE = 'jotter-export-formats.html'
const CHOICE_TITLE = 'jotter export formats'
const PROMPT =
  'Show the export formats people asked for in jotter issues as tiles I can pick, with a button to plan the ones I choose.'
const REPLY_BEFORE = 'Requests per format, from open jotter issues. Pick the ones for 1.0:'
const REPLY_AFTER = 'Markdown and PDF have the most requests.'
const PICKED = ['Markdown', 'PDF', 'HTML'] as const
const FOLLOW_UP = 'Plan the export work for Markdown, PDF and HTML.'
const ANSWER =
  'Markdown and HTML can share one renderer, so they come first. PDF renders that HTML in a headless browser, which adds one dependency.'
/** The marker the capture waits for inside the frame. */
const FRAME_READY_TEXT = 'Plan these formats'

/**
 * Selectable tiles and one primary action, with the skill's own utilities (`.viz-grid`,
 * `.btn.viz-tile`, `.btn-primary`, `.text-muted`, `.text-small`). The selection survives a
 * reload through `window.openai.visualizationState`.
 */
const FRAGMENT = `<div id="jotter-export-formats">
<style>
#jotter-export-formats { padding: 16px; }
</style>
<div class="viz-grid" role="group" aria-label="Export formats"></div>
<div class="viz-row" style="margin-top: 16px">
  <span class="summary" aria-live="polite"></span>
  <button class="btn btn-primary" type="button" disabled>Plan these formats</button>
</div>
</div>
<script>
(() => {
  const formats = [
    ['markdown', 'Markdown', 34], ['pdf', 'PDF', 27], ['html', 'HTML', 19],
    ['epub', 'EPUB', 8], ['docx', 'Word (.docx)', 6], ['txt', 'Plain text', 4],
  ];
  const root = document.getElementById('jotter-export-formats');
  const grid = root.querySelector('.viz-grid');
  const summary = root.querySelector('.summary');
  const action = root.querySelector('.btn-primary');
  const known = new Set(formats.map(([id]) => id));
  const restored = window.openai?.visualizationState?.selected;
  const selected = new Set(Array.isArray(restored) ? restored.filter((id) => known.has(id)) : []);
  const names = () => formats.filter(([id]) => selected.has(id)).map(([, name]) => name);
  function list(items) {
    return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items.at(-1);
  }
  function render() {
    for (const tile of grid.children) tile.setAttribute('aria-pressed', String(selected.has(tile.dataset.id)));
    summary.textContent = selected.size === 0 ? 'Nothing picked yet' : selected.size + ' picked';
    action.disabled = selected.size === 0;
    window.openai?.setVisualizationState?.(selected.size === 0 ? null : { selected: [...selected] });
  }
  for (const [id, name, requests] of formats) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'btn viz-tile';
    tile.dataset.id = id;
    tile.innerHTML = '<strong>' + name + '</strong> <span class="text-muted text-small">' + requests + ' requests</span>';
    tile.addEventListener('click', () => {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      render();
    });
    grid.append(tile);
  }
  action.addEventListener('click', () => {
    window.openai?.sendFollowUpMessage?.({
      prompt: 'Plan the export work for ' + list(names()) + '.',
      title: 'Plan these export formats?',
    });
  });
  render();
})();
</script>
`

const CHOICE_CONVERSATION = {
  sessionTitle: CHOICE_SESSION_TITLE,
  file: CHOICE_FILE,
  visualizationTitle: CHOICE_TITLE,
  fragment: FRAGMENT,
  prompt: PROMPT,
  replyBefore: REPLY_BEFORE,
  replyAfter: REPLY_AFTER,
  nextMessage: FOLLOW_UP,
  answer: ANSWER,
} as const

/**
 * The picker with three formats chosen, the message its button sent, and the agent's answer:
 * a choice made in the visualization, carried back to the agent.
 */
export async function captureVisualizationChoice(context: CaptureContext) {
  const { page } = context
  await ensureVisualizationConversation(context, CHOICE_CONVERSATION)
  await openSession(page, CHOICE_SESSION_TITLE)
  const surface = page.locator(`section[data-visualization-path$="${CHOICE_FILE}"]`)
  const frame = surface.frameLocator('iframe')
  await frame.getByText(FRAME_READY_TEXT).waitFor({ timeout: UI_TIMEOUT_MS })
  for (const name of PICKED) {
    await frame.getByRole('button', { name: new RegExp(`^${name} `) }).click()
  }
  await frame.getByText(`${String(PICKED.length)} picked`).waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  const log = page.getByRole('log', { name: 'Chat messages' })
  const before = log.getByText(REPLY_BEFORE)
  const answer = log.getByText(ANSWER)
  // Close under the answer: the message's action icons sit just below it.
  await shootRegion(context, 'visualization-choice.png', async () => {
    const box = unionRegion(
      [await regionOf(before), await regionOf(surface), await regionOf(answer)],
      CROP_MARGIN_PX,
    )
    return { ...box, height: box.height - CROP_MARGIN_PX + TIGHT_PAD_PX }
  })
}
