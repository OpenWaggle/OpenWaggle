import { describe, expect, it } from 'vitest'
import { getToolActionText, getToolVerbs } from '../tool-display'

describe('getToolVerbs', () => {
  it('returns known verbs for readFile', () => {
    const verbs = getToolVerbs('readFile')
    expect(verbs).toEqual({ running: 'Reading', completed: 'Read' })
  })

  it('returns known verbs for runCommand', () => {
    const verbs = getToolVerbs('runCommand')
    expect(verbs).toEqual({ running: 'Running', completed: 'Ran' })
  })

  it('returns tool name for unknown tool', () => {
    const verbs = getToolVerbs('unknownTool')
    expect(verbs).toEqual({ running: 'unknownTool', completed: 'unknownTool' })
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
