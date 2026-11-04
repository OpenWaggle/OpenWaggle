import path from 'node:path'
import {
  configureFakeAnthropic,
  type FakeModelReply,
  type FakeModelRequest,
  type FakeModelResponder,
  startFakeAnthropic,
} from './website-screenshot-fake-model'

/** Until a capture scripts its turns, a request gets a title (no tools) or a short reply. */
function defaultReply(request: FakeModelRequest): FakeModelReply {
  return request.hasTools
    ? { text: 'Done.' }
    : { text: JSON.stringify({ title: 'Screenshot fixture', needsRefinement: false }) }
}

type ScreenshotModel = Awaited<ReturnType<typeof startFakeAnthropic>> & {
  readonly setResponder: (responder: FakeModelResponder) => void
}

let running: ScreenshotModel | null = null

/**
 * Starts the loopback model for the whole capture run and points the scratch Pi agent directory
 * at it, before the app's first launch reads `models.json`.
 */
export async function startScreenshotModel(homeDir: string) {
  let responder: FakeModelResponder = defaultReply
  const server = await startFakeAnthropic((request) => responder(request))
  await configureFakeAnthropic(path.join(homeDir, '.pi', 'agent'), server.baseUrl)
  running = {
    ...server,
    setResponder: (next) => {
      responder = next
    },
  }
  return running
}

export function screenshotModel() {
  if (!running) throw new Error('The screenshot model server is not running.')
  return running
}
