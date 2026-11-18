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
  it('add the commands only a Run loads, to those read from its file', () => {
    rememberRunExtensionCommands('session-1', [
      { name: 'qa-run-only', description: 'Only in a Run' },
      { name: 'qa-hello', description: 'From the Run' },
    ])

    expect(
      withRunExtensionCommands('session-1', [{ name: 'qa-hello', description: 'Read' }]),
    ).toEqual([
      { name: 'qa-hello', description: 'Read' },
      { name: 'qa-run-only', description: 'Only in a Run' },
    ])
  })

  it('are forgotten with the Session', () => {
    rememberRunExtensionCommands('session-1', [{ name: 'qa-run-only' }])
    forgetRunExtensionCommands('session-1')

    expect(withRunExtensionCommands('session-1', [])).toEqual([])
  })
})
