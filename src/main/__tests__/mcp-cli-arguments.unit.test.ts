import { describe, expect, it } from 'vitest'
import {
  addDefinition,
  parseMcpCliArguments,
  target,
  validateMcpCliOptions,
} from '../mcp-cli-arguments'

describe('MCP CLI arguments', () => {
  it('rejects unknown options for the selected command', () => {
    const arguments_ = parseMcpCliArguments(['docs', '--scpoe', 'global', '--', 'docs-mcp'])

    expect(() => validateMcpCliOptions('add', arguments_)).toThrow('Unknown option: --scpoe.')
  })

  it('accepts immutable origin-session provenance for hosted server profiles', () => {
    const arguments_ = parseMcpCliArguments(['--stdio', '--origin-session', 'session-1'])

    expect(() => validateMcpCliOptions('serve', arguments_)).not.toThrow()
  })

  it('rejects a hosted origin-session option without a value', () => {
    const arguments_ = parseMcpCliArguments(['--stdio', '--origin-session'])

    expect(() => validateMcpCliOptions('serve', arguments_)).toThrow(
      'Missing value for --origin-session.',
    )
  })

  it.each([
    'workspace',
    'session',
    'origin-session',
    'grant',
  ])('rejects serve-only --%s on management commands', (name) => {
    const arguments_ = parseMcpCliArguments([`--${name}`, 'value'])

    expect(() => validateMcpCliOptions('list', arguments_)).toThrow(`Unknown option: --${name}.`)
  })

  it('rejects an invalid scope instead of falling back to project', () => {
    const arguments_ = parseMcpCliArguments(['--scope', 'glboal'])

    expect(() => target(arguments_)).toThrow('Unsupported MCP scope "glboal"')
    expect(() => validateMcpCliOptions('import', arguments_)).toThrow(
      'Unsupported MCP scope "glboal"',
    )
  })

  it('accepts both supported scopes', () => {
    expect(target(parseMcpCliArguments([]))).toBe('project')
    expect(target(parseMcpCliArguments(['--scope', 'project']))).toBe('project')
    expect(target(parseMcpCliArguments(['--scope', 'global']))).toBe('global')
  })

  it.each([
    ['transport', 'stdioo', 'Unsupported MCP transport "stdioo"'],
    ['compatibility', 'legacy', 'Unsupported MCP compatibility profile "legacy"'],
  ])('rejects an invalid --%s value', (option, value, message) => {
    const arguments_ = parseMcpCliArguments([
      '--url',
      'https://example.com/mcp',
      `--${option}`,
      value,
    ])

    expect(() => addDefinition(arguments_)).toThrow(message)
  })

  it('accepts supported transport and compatibility values', () => {
    const definition = addDefinition(
      parseMcpCliArguments([
        '--url',
        'https://example.com/mcp',
        '--transport',
        'streamable-http',
        '--compatibility',
        'modern-only',
      ]),
    )

    expect(definition).toMatchObject({
      transport: 'streamable-http',
      compatibility: 'modern-only',
    })
  })
})
