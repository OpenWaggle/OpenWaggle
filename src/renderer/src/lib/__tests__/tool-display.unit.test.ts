import type { JsonObject } from '@shared/types/json'
import { describe, expect, it } from 'vitest'
import { resolveActionText } from '../tool-display'

function actionText(name: string, args: JsonObject, isRunning: boolean): string {
  return resolveActionText({
    name,
    args,
    awaitingResult: false,
    isError: false,
    isRunning,
  })
}

describe('resolveActionText', () => {
  const writeArgs = { path: 'test.txt' }
  const bashArgs = { command: 'pnpm test' }

  it('returns pending text when awaitingResult', () => {
    expect(
      resolveActionText({
        name: 'write',
        args: writeArgs,
        awaitingResult: true,
        isError: false,
        isRunning: false,
      }),
    ).toBe('Requested write test.txt')
  })

  it('returns error text when isError', () => {
    expect(
      resolveActionText({
        name: 'bash',
        args: bashArgs,
        awaitingResult: false,
        isError: true,
        isRunning: false,
      }),
    ).toBe('Failed bash `pnpm test`')
  })

  it('returns running text when isRunning', () => {
    expect(actionText('write', writeArgs, true)).toBe('Writing test.txt...')
  })

  it('returns completed text when nothing is active', () => {
    expect(actionText('write', writeArgs, false)).toBe('Wrote test.txt')
  })

  it('includes read line ranges when offset and limit are present', () => {
    expect(actionText('read', { path: 'src/main/index.ts', offset: 10, limit: 5 }, false)).toBe(
      'Read src/main/index.ts:10-14',
    )
  })

  it('wraps commands in backticks for bash', () => {
    expect(actionText('bash', bashArgs, false)).toBe('Ran `pnpm test`')
    expect(actionText('bash', bashArgs, true)).toBe('Running `pnpm test`')
  })

  it('returns verb text when no primary arg is available', () => {
    expect(actionText('read', {}, true)).toBe('Reading...')
    expect(actionText('read', {}, false)).toBe('Read')
    expect(actionText('customTool', {}, true)).toBe('customTool...')
    expect(actionText('customTool', {}, false)).toBe('customTool')
  })

  it('formats Pi filesystem tool targets', () => {
    expect(actionText('grep', { pattern: 'TODO', path: 'src', glob: '*.ts' }, false)).toBe(
      'Searched /TODO/ in src (*.ts)',
    )
    expect(actionText('find', { pattern: '*.tsx', path: 'src' }, false)).toBe('Found *.tsx in src')
    expect(actionText('ls', { path: 'src' }, false)).toBe('Listed src')
  })
})
