// Runs one settled Waggle turn of pi-waggle's default extension from its CommonJS build. pi-ai,
// which judges a turn's error, is ESM-only and cannot load there; the turn must still settle and
// the next one start, on every Run.
const assert = require('node:assert/strict')

const extension = require('@openwaggle/pi-waggle/extension')
const defaultPiWaggleExtension = extension.default ?? extension

function modelFor(reference) {
  const [provider, id] = reference.split('/')
  return { provider, id }
}

function createPi() {
  const commands = new Map()
  const handlers = new Map()
  const sentUserMessages = []
  const pi = {
    appendEntry() {},
    getFlag() {},
    on(name, handler) {
      handlers.set(name, handler)
    },
    registerCommand(name, options) {
      commands.set(name, options)
    },
    registerTool() {},
    registerMessageRenderer() {},
    sendMessage() {},
    sendUserMessage(message) {
      sentUserMessages.push(message)
    },
    async setModel() {
      return true
    },
  }
  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    isIdle: () => true,
    model: modelFor('openai/gpt-5.5'),
    modelRegistry: { find: (provider, id) => ({ provider, id }) },
    sessionManager: { getBranch: () => [] },
    ui: { notify() {}, setStatus() {}, setWorkingMessage() {} },
    waitForIdle: async () => undefined,
  }
  return { pi, ctx, commands, handlers, sentUserMessages }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function main() {
  const harness = createPi()
  defaultPiWaggleExtension(harness.pi)
  await harness.commands.get('waggle').handler('code-review Review this migration', harness.ctx)
  const settle = async (messages) => {
    await harness.handlers.get('agent_end')({ type: 'agent_end', messages }, harness.ctx)
    await harness.handlers.get('agent_settled')({ type: 'agent_settled' }, harness.ctx)
    await tick()
  }

  await settle([
    { role: 'assistant', content: [], stopReason: 'error', errorMessage: '503 Service Unavailable' },
  ])
  await settle([{ role: 'assistant', content: [{ type: 'text', text: 'Reviewed.' }] }])

  assert.deepEqual(harness.sentUserMessages, [
    'Review this migration',
    'Continue Waggle turn 2 as Reviewer.',
    'Continue Waggle turn 3 as Architect.',
  ])
  console.log('cjs settled Waggle turn smoke passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
