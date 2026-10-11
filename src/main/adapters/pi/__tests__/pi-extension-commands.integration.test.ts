import { afterEach, describe, expect, it } from 'vitest'
import { piExtensionCommands } from '../agent-kernel/pi-extension-commands'
import {
  cleanupOpenWagglePiSessions,
  createOpenWagglePiSession,
} from './openwaggle-pi-session.test-support'

afterEach(() => {
  cleanupOpenWagglePiSessions()
})

describe("a Session's Pi extension commands", () => {
  it('are the commands its extensions register, by the name they are invoked with', async () => {
    const { session } = await createOpenWagglePiSession({
      extensionFactories: [
        (pi) => {
          pi.registerCommand('qa-hello', {
            description: 'Say hello from the QA extension',
            handler: async () => {},
          })
          pi.registerCommand('qa-quiet', { handler: async () => {} })
        },
      ],
    })

    const commands = piExtensionCommands(session)

    expect(commands).toContainEqual({
      name: 'qa-hello',
      description: 'Say hello from the QA extension',
    })
    expect(commands).toContainEqual({ name: 'qa-quiet' })
  })
})
