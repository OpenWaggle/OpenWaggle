import { describe, expect, it } from 'vitest'
import { option } from '../mcp-cli-arguments'
import { parseRunCliArguments } from '../run-cli-arguments'

function launchArguments(args: readonly string[]) {
  const invocation = parseRunCliArguments(args)
  if (invocation.kind !== 'run') throw new Error('Expected a run invocation.')
  return invocation
}

describe('openwaggle run arguments', () => {
  it('joins prompt words into launch text for the current project', () => {
    const invocation = launchArguments(['fix', 'the', 'failing', 'tests', '--yolo'])

    expect(invocation.jsonl).toBe(false)
    expect(invocation.launchArguments.positionals).toEqual(['.'])
    expect(option(invocation.launchArguments, 'text')).toBe('fix the failing tests')
    expect(option(invocation.launchArguments, 'yolo')).toBe('true')
  })

  it('keeps words after -- in the prompt', () => {
    const invocation = launchArguments(['explain', '--', '--frozen-lockfile'])

    expect(option(invocation.launchArguments, 'text')).toBe('explain --frozen-lockfile')
  })

  it('maps --project to the launch target and strips run-only options', () => {
    const invocation = launchArguments([
      '--project',
      '../api',
      '--jsonl',
      '--model',
      'openai/gpt-5',
      'summarize',
    ])

    expect(invocation.jsonl).toBe(true)
    expect(invocation.launchArguments.positionals).toEqual(['../api'])
    expect(invocation.launchArguments.options.has('project')).toBe(false)
    expect(invocation.launchArguments.options.has('jsonl')).toBe(false)
    expect(option(invocation.launchArguments, 'model')).toBe('openai/gpt-5')
  })

  it('accepts explicit input sources instead of prompt words', () => {
    const invocation = launchArguments(['--stdin'])

    expect(invocation.launchArguments.options.has('text')).toBe(false)
    expect(option(invocation.launchArguments, 'stdin')).toBe('true')
  })

  it.each([[['--help']], [['-h']], [['fix', '--help']]])('recognizes help in %j', (args) => {
    expect(parseRunCliArguments(args)).toEqual({ kind: 'help' })
  })

  it('requires a prompt', () => {
    expect(() => parseRunCliArguments([])).toThrow('A prompt is required')
    expect(() => parseRunCliArguments(['--yolo'])).toThrow('A prompt is required')
  })

  it('rejects a prompt given twice', () => {
    expect(() => parseRunCliArguments(['fix', '--text', 'other'])).toThrow('not both')
  })

  it('rejects unknown and misplaced options before any side effect', () => {
    expect(() => parseRunCliArguments(['fix', '--yolow'])).toThrow('Unknown option')
    expect(() => parseRunCliArguments(['fix', '--request-json', 'x.json'])).toThrow(
      'Unknown option',
    )
    expect(() => parseRunCliArguments(['fix', '--yolo=1'])).toThrow('do not accept values')
  })
})
