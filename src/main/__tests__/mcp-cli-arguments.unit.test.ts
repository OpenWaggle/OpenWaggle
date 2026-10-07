import { describe, expect, it } from 'vitest'
import {
  parseMcpCliArguments,
  requireServeScope,
  serveAuthorizationCeiling,
  validateMcpCliOptions,
} from '../mcp-cli-arguments'

describe('MCP CLI arguments', () => {
  it('rejects unknown options for the selected command', () => {
    const arguments_ = parseMcpCliArguments(['--stdio', '--scpoe', 'global'])

    expect(() => validateMcpCliOptions('serve', arguments_)).toThrow('Unknown option: --scpoe.')
  })

  it('accepts immutable origin-session provenance for hosted server profiles', () => {
    const arguments_ = parseMcpCliArguments(['--stdio', '--origin-session', 'session-1'])

    expect(() => validateMcpCliOptions('serve', arguments_)).not.toThrow()
  })

  it('defaults hosted callers to Ask and requires an explicit reviewed YOLO ceiling', () => {
    expect(serveAuthorizationCeiling(parseMcpCliArguments(['--stdio']))).toBe('ask-for-approval')
    expect(
      serveAuthorizationCeiling(
        parseMcpCliArguments(['--stdio', '--authorization-ceiling', 'yolo']),
      ),
    ).toBe('yolo')
    expect(() =>
      validateMcpCliOptions(
        'serve',
        parseMcpCliArguments(['--stdio', '--authorization-ceiling', 'unrestricted']),
      ),
    ).toThrow('Unsupported MCP authorization ceiling "unrestricted"')
  })

  it('enforces positional and passthrough contracts before the server starts', () => {
    expect(() => validateMcpCliOptions('serve', parseMcpCliArguments(['extra']))).toThrow(
      'received unexpected positional arguments',
    )
    expect(() =>
      validateMcpCliOptions('serve', parseMcpCliArguments(['--stdio', '--', 'command'])),
    ).toThrow('does not accept arguments after --')
    expect(() => validateMcpCliOptions('help', parseMcpCliArguments([]))).not.toThrow()
  })

  it.each(['add', 'list', 'get', 'remove', 'import', 'registry', 'doctor', 'unknown'])(
    'rejects the %s command, which `openwaggle mcp` no longer offers',
    (command) => {
      expect(() => validateMcpCliOptions(command, parseMcpCliArguments([]))).toThrow(
        'Unsupported MCP command',
      )
    },
  )

  it('rejects values assigned to MCP boolean flags', () => {
    expect(() => validateMcpCliOptions('serve', parseMcpCliArguments(['--stdio=false']))).toThrow(
      '--stdio do not accept values',
    )
  })

  it('requires an explicit workspace or session scope for hosted server mode', () => {
    expect(() => requireServeScope(parseMcpCliArguments(['--stdio']))).toThrow(
      'requires at least one explicit --workspace <path> or --session <id>',
    )
    expect(() =>
      requireServeScope(parseMcpCliArguments(['--stdio', '--workspace', '/project'])),
    ).not.toThrow()
    expect(() =>
      requireServeScope(parseMcpCliArguments(['--stdio', '--session', 'session-1'])),
    ).not.toThrow()
  })

  it('rejects a hosted origin-session option without a value', () => {
    const arguments_ = parseMcpCliArguments(['--stdio', '--origin-session'])

    expect(() => validateMcpCliOptions('serve', arguments_)).toThrow(
      'Missing value for --origin-session.',
    )
  })

  it.each(['workspace', 'session', 'origin-session', 'grant', 'authorization-ceiling'])(
    'rejects serve-only --%s on help',
    (name) => {
      const arguments_ = parseMcpCliArguments([`--${name}`, 'value'])

      expect(() => validateMcpCliOptions('help', arguments_)).toThrow(`Unknown option: --${name}.`)
    },
  )
})
