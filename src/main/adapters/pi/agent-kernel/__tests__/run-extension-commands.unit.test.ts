import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetRunExtensionCommands,
  rememberRunExtensionCommands,
  withRunExtensionCommands,
} from '../run-extension-commands'

afterEach(() => {
  forgetRunExtensionCommands('session-1')
})

describe('the extension commands a Session listed in its last Run', () => {
  it('add the commands only a Run loads, such as MCP’s /mcp, to those read from its file', () => {
    rememberRunExtensionCommands('session-1', [
      { name: 'mcp', description: 'Manage MCP servers' },
      { name: 'qa-hello', description: 'From the Run' },
    ])

    expect(
      withRunExtensionCommands('session-1', [{ name: 'qa-hello', description: 'Read' }]),
    ).toEqual([
      { name: 'qa-hello', description: 'Read' },
      { name: 'mcp', description: 'Manage MCP servers' },
    ])
  })

  it('are forgotten with the Session', () => {
    rememberRunExtensionCommands('session-1', [{ name: 'mcp' }])
    forgetRunExtensionCommands('session-1')

    expect(withRunExtensionCommands('session-1', [])).toEqual([])
  })
})
