import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../application-cli-arguments'

describe('application CLI argument routing', () => {
  it('selects the packaged command from its canonical top-level position', () => {
    expect(
      applicationCliArguments(
        [
          '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
          'hive',
          'message',
          'id',
          '--text',
          'access',
        ],
        { isPackaged: true },
      ),
    ).toEqual(['hive', 'message', 'id', '--text', 'access'])
  })

  it('skips the Electron app path in development', () => {
    expect(
      applicationCliArguments(
        ['/path/to/electron', '/workspace/OpenWaggle', 'hive', 'message', 'id', '--text', 'mcp'],
        { isPackaged: false },
      ),
    ).toEqual(['hive', 'message', 'id', '--text', 'mcp'])
  })

  it.each([false, true])('normalizes retained runtime prefixes when packaged=%s', (isPackaged) => {
    expect(
      applicationCliArguments(
        [
          '/path/to/electron',
          '--no-sandbox',
          '--disable-logging',
          '--log-level=3',
          '--use-mock-keychain',
          '--password-store=basic',
          ...(isPackaged ? [] : ['/workspace/OpenWaggle']),
          'hive',
          'list',
          '--all',
        ],
        { isPackaged },
      ),
    ).toEqual(['hive', 'list', '--all'])
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
      'hive',
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
      '--use-mock-keychain',
      '--password-store=basic',
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
        'hive',
        'list',
      ]

      expect(
        applicationCliArguments(['/path/to/electron', '--no-sandbox', ...unrecognizedArguments], {
          isPackaged,
        }),
      ).toEqual(unrecognizedArguments)
    },
  )

  it('does not treat a malformed password store switch as a recognized runtime prefix', () => {
    expect(
      applicationCliArguments(['/path/to/electron', '--password-store=', 'hive', 'list'], {
        isPackaged: true,
      }),
    ).toEqual(['--password-store=', 'hive', 'list'])
  })

  it('does not treat arbitrary logging values as recognized runtime prefixes', () => {
    expect(
      applicationCliArguments(['/path/to/electron', '--log-level=arbitrary', 'hive', 'list'], {
        isPackaged: true,
      }),
    ).toEqual(['--log-level=arbitrary', 'hive', 'list'])
  })

  it.each([false, true])('consumes one application boundary when packaged=%s', (isPackaged) => {
    const applicationArguments = [
      'access',
      'profiles',
      'create',
      'worker',
      '--capability',
      'sessions:read',
      '--management-envelope-json',
      '{"capabilities":["sessions:read"]}',
      '--json',
    ]
    expect(
      applicationCliArguments(
        [
          '/path/to/electron',
          '--no-sandbox',
          ...(isPackaged ? [] : ['/workspace/OpenWaggle']),
          '--',
          ...applicationArguments,
        ],
        { isPackaged },
      ),
    ).toEqual(applicationArguments)
  })

  it.each([false, true])(
    'preserves all tokens beyond the boundary when packaged=%s',
    (isPackaged) => {
      const prefix = ['/path/to/electron', ...(isPackaged ? [] : ['/workspace/OpenWaggle']), '--']
      for (const applicationArguments of [
        ['--', 'hive', 'list'],
        ['--no-sandbox', 'hive', 'list'],
        ['hive', 'message', 'id', '--text', '--', '--json'],
        ['hive', 'message', 'id', '--text', 'https://example.test/', '--json'],
      ]) {
        expect(
          applicationCliArguments([...prefix, ...applicationArguments], { isPackaged }),
        ).toEqual(applicationArguments)
      }
    },
  )

  it('does not consume a boundary in place of the development app path', () => {
    const arguments_ = ['--', '/workspace/OpenWaggle', 'hive', 'list']
    expect(
      applicationCliArguments(['/path/to/electron', ...arguments_], { isPackaged: false }),
    ).toEqual(arguments_)
  })
})
