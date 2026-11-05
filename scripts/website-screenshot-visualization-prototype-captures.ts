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
 * A prototype the user clicks through, then talks about. The agent mocked up jotter's new export
 * dialog as two screens. The visualization reports which screen is open and what is filled in
 * with `setVisualizationState`, so the user's next message, typed in the composer, could say
 * "this screen", and the agent's answer names the screen, the file name and the format. The capture clicks Next, so the image shows the
 * screen the message is about. Styled as jotter, not with the visualization's own utilities, as
 * the skill asks of mockups.
 */

const PROTOTYPE_SESSION_TITLE = 'Prototype the export dialog'
const PROTOTYPE_FILE = 'jotter-export-dialog.html'
const PROTOTYPE_TITLE = 'jotter export dialog'
const PROMPT = 'Mock up the new two-step export dialog for jotter so I can click through it.'
const REPLY_BEFORE = 'Here is the export dialog. Next and Back move between its two screens:'
const REPLY_AFTER =
  'It remembers the screen and the values you pick, so you can tell me what to change.'
const NEXT_MESSAGE = 'What happens on this screen if the folder does not exist yet?'
const ANSWER =
  'On Destination, the screen you have open, Export creates the folder first and then writes release-notes.pdf, since you picked PDF.'
/** The marker the capture waits for inside the frame. */
const FRAME_READY_TEXT = 'Export notes'
const DESTINATION_HEADING = 'Destination'

const FRAGMENT = `<div id="jotter-export-dialog">
<style>
#jotter-export-dialog {
  --jt-surface: light-dark(#ffffff, #1f2328);
  --jt-text: light-dark(#1f2328, #e6e8eb);
  --jt-muted: light-dark(#59636e, #9aa4ae);
  --jt-line: light-dark(#d1d9e0, #3a4048);
  --jt-field: light-dark(#f6f8fa, #171a1e);
  --jt-brand: #6d5dfc;
  padding: 16px; font-family: "Inter", system-ui, sans-serif; color: var(--jt-text);
}
#jotter-export-dialog .window { max-width: 420px; margin: 0 auto; background: var(--jt-surface); border: 1px solid var(--jt-line); border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); }
#jotter-export-dialog h2 { margin: 0; font-size: 17px; }
#jotter-export-dialog .step { margin: 4px 0 16px; color: var(--jt-muted); font-size: 13px; }
#jotter-export-dialog h3 { margin: 0 0 10px; font-size: 14px; }
#jotter-export-dialog .formats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
#jotter-export-dialog .formats label { border: 1px solid var(--jt-line); border-radius: 8px; padding: 10px; font-size: 13px; cursor: pointer; }
#jotter-export-dialog .formats input { accent-color: var(--jt-brand); margin-right: 6px; }
#jotter-export-dialog .field { display: grid; gap: 4px; margin-bottom: 12px; font-size: 13px; }
#jotter-export-dialog .field span { color: var(--jt-muted); }
#jotter-export-dialog .field input { background: var(--jt-field); color: var(--jt-text); border: 1px solid var(--jt-line); border-radius: 6px; padding: 8px; font: inherit; }
#jotter-export-dialog .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
#jotter-export-dialog button { font: inherit; font-size: 13px; border-radius: 6px; padding: 7px 14px; border: 1px solid var(--jt-line); background: transparent; color: var(--jt-text); cursor: pointer; }
#jotter-export-dialog button.primary { background: var(--jt-brand); border-color: var(--jt-brand); color: #ffffff; }
</style>
<div class="window" role="dialog" aria-labelledby="jt-export-title">
  <h2 id="jt-export-title">Export notes</h2>
  <p class="step"></p>
  <section data-screen="format">
    <h3>Format</h3>
    <div class="formats">
      <label><input type="radio" name="format" value="markdown">Markdown</label>
      <label><input type="radio" name="format" value="pdf">PDF</label>
      <label><input type="radio" name="format" value="html">HTML</label>
    </div>
  </section>
  <section data-screen="destination" hidden>
    <h3>Destination</h3>
    <label class="field"><span>File name</span><input name="fileName" value="release-notes"></label>
    <label class="field"><span>Folder</span><input name="folder" value="~/Documents/jotter"></label>
  </section>
  <div class="actions">
    <button type="button" data-action="back">Back</button>
    <button type="button" class="primary" data-action="next">Next</button>
  </div>
</div>
</div>
<script>
(() => {
  const root = document.getElementById('jotter-export-dialog');
  const screens = ['format', 'destination'];
  const restored = window.openai?.visualizationState ?? {};
  const state = {
    screen: screens.includes(restored.screen) ? restored.screen : 'format',
    format: ['markdown', 'pdf', 'html'].includes(restored.format) ? restored.format : 'pdf',
  };
  const step = root.querySelector('.step');
  const back = root.querySelector('[data-action="back"]');
  const next = root.querySelector('[data-action="next"]');
  function render() {
    for (const section of root.querySelectorAll('[data-screen]')) section.hidden = section.dataset.screen !== state.screen;
    for (const radio of root.querySelectorAll('input[name="format"]')) radio.checked = radio.value === state.format;
    const index = screens.indexOf(state.screen);
    step.textContent = 'Step ' + (index + 1) + ' of ' + screens.length;
    back.disabled = index === 0;
    next.textContent = index === screens.length - 1 ? 'Export' : 'Next';
    window.openai?.setVisualizationState?.({ screen: state.screen, format: state.format });
  }
  root.addEventListener('change', (event) => {
    if (event.target.name === 'format') { state.format = event.target.value; render(); }
  });
  back.addEventListener('click', () => { state.screen = 'format'; render(); });
  next.addEventListener('click', () => { if (state.screen === 'format') { state.screen = 'destination'; render(); } });
  render();
})();
</script>
`

const PROTOTYPE_CONVERSATION = {
  sessionTitle: PROTOTYPE_SESSION_TITLE,
  file: PROTOTYPE_FILE,
  visualizationTitle: PROTOTYPE_TITLE,
  fragment: FRAGMENT,
  prompt: PROMPT,
  replyBefore: REPLY_BEFORE,
  replyAfter: REPLY_AFTER,
  nextMessage: NEXT_MESSAGE,
  answer: ANSWER,
} as const

/**
 * The prototype on its second screen, the question about "this screen", and the agent's answer,
 * which uses the screen, file name and format the visualization reported.
 */
export async function captureVisualizationPrototype(context: CaptureContext) {
  const { page } = context
  await ensureVisualizationConversation(context, PROTOTYPE_CONVERSATION)
  await openSession(page, PROTOTYPE_SESSION_TITLE)
  const surface = page.locator(`section[data-visualization-path$="${PROTOTYPE_FILE}"]`)
  const frame = surface.frameLocator('iframe')
  await frame.getByText(FRAME_READY_TEXT).waitFor({ timeout: UI_TIMEOUT_MS })
  await frame.getByRole('button', { name: 'Next' }).click()
  await frame
    .getByRole('heading', { name: DESTINATION_HEADING })
    .waitFor({ timeout: UI_TIMEOUT_MS })
  await waitForUi(page)
  const log = page.getByRole('log', { name: 'Chat messages' })
  const before = log.getByText(REPLY_BEFORE)
  const answer = log.getByText(ANSWER)
  // Close under the answer: the message's action icons sit just below it.
  await shootRegion(context, 'visualization-prototype.png', async () => {
    const box = unionRegion(
      [await regionOf(before), await regionOf(surface), await regionOf(answer)],
      CROP_MARGIN_PX,
    )
    return { ...box, height: box.height - CROP_MARGIN_PX + TIGHT_PAD_PX }
  })
}
