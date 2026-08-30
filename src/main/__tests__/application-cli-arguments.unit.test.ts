import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../application-cli-arguments'

describe('application CLI argument routing', () => {
  it('selects the packaged command from its canonical top-level position', () => {
    expect(
      applicationCliArguments(
        [
          '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
          'sessions',
          'message',
          'id',
          '--text',
          'access',
        ],
        { isPackaged: true },
      ),
    ).toEqual(['sessions', 'message', 'id', '--text', 'access'])
  })

  it('skips the Electron app path in development', () => {
    expect(
      applicationCliArguments(
        [
          '/path/to/electron',
          '/workspace/OpenWaggle',
          'sessions',
          'message',
          'id',
          '--text',
          'mcp',
        ],
        { isPackaged: false },
      ),
    ).toEqual(['sessions', 'message', 'id', '--text', 'mcp'])
  })
})
