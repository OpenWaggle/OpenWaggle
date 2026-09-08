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

  it.each([false, true])('normalizes retained runtime prefixes when packaged=%s', (isPackaged) => {
    expect(
      applicationCliArguments(
        [
          '/path/to/electron',
          '--no-sandbox',
          '--disable-logging',
          '--log-level=3',
          ...(isPackaged ? [] : ['/workspace/OpenWaggle']),
          'sessions',
          'list',
          '--all',
        ],
        { isPackaged },
      ),
    ).toEqual(['sessions', 'list', '--all'])
  })

  it('accepts known runtime switches between the development app path and command', () => {
    expect(
      applicationCliArguments(
        ['/path/to/electron', '/workspace/OpenWaggle', '--no-sandbox', 'session-host-internal'],
        { isPackaged: false },
      ),
    ).toEqual(['session-host-internal'])
  })

  it.each([false, true])('preserves every application token when packaged=%s', (isPackaged) => {
    const applicationArguments = [
      'sessions',
      'message',
      'id',
      '--text',
      '--no-sandbox',
      '--input-file',
      'access',
      '--request-json',
      'mcp',
      '--disable-logging',
      '--log-level=3',
    ]

    expect(
      applicationCliArguments(
        [
          '/path/to/electron',
          ...(isPackaged ? [] : ['/workspace/OpenWaggle']),
          ...applicationArguments,
        ],
        { isPackaged },
      ),
    ).toEqual(applicationArguments)
  })

  it.each([false, true])(
    'does not skip an unknown leading switch when packaged=%s',
    (isPackaged) => {
      const unrecognizedArguments = [
        '--unknown-runtime-switch',
        ...(isPackaged ? [] : ['/workspace/OpenWaggle']),
        'sessions',
        'list',
      ]

      expect(
        applicationCliArguments(['/path/to/electron', '--no-sandbox', ...unrecognizedArguments], {
          isPackaged,
        }),
      ).toEqual(unrecognizedArguments)
    },
  )

  it('does not treat arbitrary logging values or an option terminator as recognized prefixes', () => {
    for (const prefix of ['--log-level=arbitrary', '--']) {
      expect(
        applicationCliArguments(['/path/to/electron', prefix, 'sessions', 'list'], {
          isPackaged: true,
        }),
      ).toEqual([prefix, 'sessions', 'list'])
    }
  })
})
