import { describe, expect, it } from 'vitest'
import {
  getToolActionText,
  getToolApprovalText,
  getToolVerbs,
  resolveActionText,
} from '../tool-display'

describe('getToolVerbs', () => {
  it('returns known verbs for readFile', () => {
    const verbs = getToolVerbs('readFile')
    expect(verbs).toEqual({ running: 'Reading', completed: 'Read', approval: 'Read' })
  })

  it('returns known verbs for runCommand', () => {
    const verbs = getToolVerbs('runCommand')
    expect(verbs).toEqual({ running: 'Running', completed: 'Ran', approval: 'Run' })
  })

  it('returns tool name for unknown tool', () => {
    const verbs = getToolVerbs('unknownTool')
    expect(verbs).toEqual({
      running: 'unknownTool',
      completed: 'unknownTool',
      approval: 'unknownTool',
    })
  })
})

describe('getToolActionText', () => {
  it('returns running text with ellipsis for readFile', () => {
    const text = getToolActionText('readFile', { path: 'src/main/index.ts' }, true)
    expect(text).toBe('Reading src/main/index.ts...')
  })

  it('returns completed text for readFile', () => {
    const text = getToolActionText('readFile', { path: 'src/main/index.ts' }, false)
    expect(text).toBe('Read src/main/index.ts')
  })

  it('wraps command in backticks for runCommand', () => {
    const text = getToolActionText('runCommand', { command: 'pnpm test' }, false)
    expect(text).toBe('Ran `pnpm test`')
  })

  it('returns running text for runCommand', () => {
    const text = getToolActionText('runCommand', { command: 'pnpm test' }, true)
    expect(text).toBe('Running `pnpm test`')
  })

  it('returns verb with ellipsis when no primary arg', () => {
    const text = getToolActionText('readFile', {}, true)
    expect(text).toBe('Reading...')
  })

  it('returns verb only when completed with no primary arg', () => {
    const text = getToolActionText('readFile', {}, false)
    expect(text).toBe('Read')
  })

  it('returns tool name for unknown tool', () => {
    const text = getToolActionText('customTool', {}, true)
    expect(text).toBe('customTool')
  })

  it('returns completed verb text for editFile', () => {
    const text = getToolActionText('editFile', { path: 'src/app.tsx' }, false)
    expect(text).toBe('Edited src/app.tsx')
  })

  it('returns running verb text for writeFile', () => {
    const text = getToolActionText('writeFile', { path: 'out.ts' }, true)
    expect(text).toBe('Writing out.ts...')
  })

  it('returns completed verb text for glob', () => {
    const text = getToolActionText('glob', { pattern: '**/*.ts' }, false)
    expect(text).toBe('Searched **/*.ts')
  })

  it('returns completed verb text for loadSkill', () => {
    const text = getToolActionText('loadSkill', { skillId: 'my-skill' }, false)
    expect(text).toBe('Loaded skill my-skill')
  })
})

describe('getToolApprovalText', () => {
  it('returns imperative verb for writeFile', () => {
    const text = getToolApprovalText('writeFile', { path: 'test-race.txt' })
    expect(text).toBe('Write test-race.txt')
  })

  it('returns imperative verb for editFile', () => {
    const text = getToolApprovalText('editFile', { path: 'src/app.tsx' })
    expect(text).toBe('Edit src/app.tsx')
  })

  it('wraps command in backticks for runCommand', () => {
    const text = getToolApprovalText('runCommand', { command: 'pnpm test' })
    expect(text).toBe('Run `pnpm test`')
  })

  it('returns verb only when no primary arg', () => {
    const text = getToolApprovalText('writeFile', {})
    expect(text).toBe('Write')
  })

  it('returns tool name for unknown tool', () => {
    const text = getToolApprovalText('customTool', {})
    expect(text).toBe('customTool')
  })
})

describe('resolveActionText', () => {
  const writeFileArgs = { path: 'test.txt' }
  const runCommandArgs = { command: 'pnpm test' }

  it('returns approval text when awaitingApproval', () => {
    expect(
      resolveActionText({
        name: 'writeFile',
        args: writeFileArgs,
        awaitingApproval: true,
        awaitingResult: false,
        isError: false,
        isRunning: false,
      }),
    ).toBe('Write test.txt')
  })

  it('returns pending text when awaitingResult', () => {
    expect(
      resolveActionText({
        name: 'writeFile',
        args: writeFileArgs,
        awaitingApproval: false,
        awaitingResult: true,
        isError: false,
        isRunning: false,
      }),
    ).toBe('Requested writeFile test.txt')
  })

  it('returns error text when isError', () => {
    expect(
      resolveActionText({
        name: 'runCommand',
        args: runCommandArgs,
        awaitingApproval: false,
        awaitingResult: false,
        isError: true,
        isRunning: false,
      }),
    ).toBe('Failed runCommand `pnpm test`')
  })

  it('returns running text when isRunning', () => {
    expect(
      resolveActionText({
        name: 'writeFile',
        args: writeFileArgs,
        awaitingApproval: false,
        awaitingResult: false,
        isError: false,
        isRunning: true,
      }),
    ).toBe('Writing test.txt...')
  })

  it('returns completed text when nothing is active', () => {
    expect(
      resolveActionText({
        name: 'writeFile',
        args: writeFileArgs,
        awaitingApproval: false,
        awaitingResult: false,
        isError: false,
        isRunning: false,
      }),
    ).toBe('Wrote test.txt')
  })

  it('prioritizes awaitingApproval over other states', () => {
    expect(
      resolveActionText({
        name: 'runCommand',
        args: runCommandArgs,
        awaitingApproval: true,
        awaitingResult: true,
        isError: true,
        isRunning: true,
      }),
    ).toBe('Run `pnpm test`')
  })
})
