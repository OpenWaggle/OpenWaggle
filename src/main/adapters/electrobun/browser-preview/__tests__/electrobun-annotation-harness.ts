import { onlyView, openPreview, setup, type Setup } from './electrobun-browser-preview-harness'

/** A CEF preview being annotated: its page script worlds and the picker's messages. */
export const MAIN_WORLD = 7
export const FRAME_WORLD = 8
const HOST_BINDING = '__openwaggleBrowserPreviewHost'

/** An open preview whose main frame and one child frame run the page script's world. */
export async function annotating(
  options: Parameters<typeof setup>[0],
  wait: () => Promise<unknown>,
) {
  const harness = setup(options)
  openPreview(harness)
  await wait()
  const view = onlyView(harness)
  const world = (id: number, frameId: string) =>
    harness.cef.emit(view, 'Runtime.executionContextCreated', {
      context: { id, name: 'openwaggle-browser-preview', auxData: { frameId } },
    })
  world(MAIN_WORLD, 'main')
  world(FRAME_WORLD, 'child')
  return { ...harness, view }
}

export function evaluations(harness: Setup) {
  return harness.cef.sent('Runtime.evaluate').map(({ params }) => params)
}

/** The token of the picker last started in the main world. */
export function pickToken(harness: Setup) {
  const started = evaluations(harness).findLast(
    (params) =>
      params['contextId'] === MAIN_WORLD && String(params['expression']).includes("kind: 'pick'"),
  )
  const token = /const token = "([^"]+)"/.exec(String(started?.['expression']))?.[1]
  if (token === undefined) throw new Error('The picker did not start in the main frame.')
  return token
}

export function report(
  harness: Awaited<ReturnType<typeof annotating>>,
  contextId: number,
  message: object,
) {
  harness.cef.emit(harness.view, 'Runtime.bindingCalled', {
    name: HOST_BINDING,
    payload: JSON.stringify(message),
    executionContextId: contextId,
  })
}

export function controlsState(harness: Setup) {
  const states = harness.sent.filter(([channel]) => channel === 'browser-preview:state')
  return states.map(([, state]) => state)
}

/** Picks once with the page reporting `payload`, as the page script's picker would. */
export async function annotateOnce(
  harness: Awaited<ReturnType<typeof annotating>>,
  payload: unknown,
  wait: () => Promise<unknown>,
) {
  const picked = harness.views.pickElement(harness.page.surface, 'p-1')
  await wait()
  report(harness, MAIN_WORLD, { kind: 'pick', token: pickToken(harness), result: payload })
  await wait()
  return picked
}
