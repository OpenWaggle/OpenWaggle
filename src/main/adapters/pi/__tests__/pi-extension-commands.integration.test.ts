import { createMcpExtension } from '@earendil-works/pi-coding-agent'
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

describe("Pi's /mcp command in OpenWaggle", () => {
  it('is listed with its description and runs under OpenWaggle’s interface', async () => {
    const { session, events } = await createOpenWagglePiSession({
      extensionFactories: [createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) })],
    })

    expect(piExtensionCommands(session)).toContainEqual({
      name: 'mcp',
      description: expect.stringContaining('Manage MCP servers'),
    })

    await session.prompt('/mcp')

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_interaction_request',
        interaction: expect.objectContaining({ kind: 'notify' }),
      }),
    )
  })
})
