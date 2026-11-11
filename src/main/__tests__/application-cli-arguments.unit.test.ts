import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../application-cli-arguments'

const BUN = '/Applications/OpenWaggle.app/Contents/MacOS/bun'
const SCRIPT = '/Applications/OpenWaggle.app/Contents/Resources/app/out/main/boot.js'

describe('application CLI argument routing', () => {
  it('selects the command after the runtime and the script it runs', () => {
    expect(
      applicationCliArguments([BUN, SCRIPT, 'hive', 'message', 'id', '--text', 'access']),
    ).toEqual(['hive', 'message', 'id', '--text', 'access'])
  })

  it('normalizes the runtime switches a Host launch keeps before its command', () => {
    expect(
      applicationCliArguments([
        BUN,
        SCRIPT,
        '--no-sandbox',
        '--disable-logging',
        '--log-level=3',
        '--use-mock-keychain',
        '--password-store=basic',
        'session-host-internal',
      ]),
    ).toEqual(['session-host-internal'])
  })

  it('preserves every application token after the command', () => {
    const applicationArguments = [
      'hive',
      'message',
      'id',
      '--text',
      '--no-sandbox',
      '--input-file',
      'access',
      '--request-file',
      'mcp',
      '--disable-logging',
      '--log-level=3',
      '--use-mock-keychain',
      '--password-store=basic',
    ]
    expect(applicationCliArguments([BUN, SCRIPT, ...applicationArguments])).toEqual(
      applicationArguments,
    )
  })

  it('does not skip an unknown leading switch', () => {
    const unrecognizedArguments = ['--unknown-runtime-switch', 'hive', 'list']
    expect(
      applicationCliArguments([BUN, SCRIPT, '--no-sandbox', ...unrecognizedArguments]),
    ).toEqual(unrecognizedArguments)
  })

  it('does not treat malformed or arbitrary switch values as runtime prefixes', () => {
    expect(applicationCliArguments([BUN, SCRIPT, '--password-store=', 'hive', 'list'])).toEqual([
      '--password-store=',
      'hive',
      'list',
    ])
    expect(applicationCliArguments([BUN, SCRIPT, '--log-level=arbitrary', 'hive', 'list'])).toEqual(
      ['--log-level=arbitrary', 'hive', 'list'],
    )
  })

  it('consumes one application boundary and keeps every token beyond it', () => {
    for (const applicationArguments of [
      ['access', 'profiles', 'create', 'worker', '--capability', 'sessions:read', '--json'],
      ['--', 'hive', 'list'],
      ['--no-sandbox', 'hive', 'list'],
      ['hive', 'message', 'id', '--text', '--', '--json'],
    ]) {
      expect(
        applicationCliArguments([BUN, SCRIPT, '--no-sandbox', '--', ...applicationArguments]),
      ).toEqual(applicationArguments)
    }
  })

  it('has no application arguments for the desktop app the launcher starts', () => {
    expect(
      applicationCliArguments([BUN, '/Applications/OpenWaggle.app/Contents/Resources/main.js']),
    ).toEqual([])
  })
})
