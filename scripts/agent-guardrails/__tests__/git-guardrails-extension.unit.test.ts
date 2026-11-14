import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterAll, describe, expect, it } from 'vitest'
import gitGuardrails, { guardToolCall } from '../../../.pi/extensions/git-guardrails'

// The Pi SDK types stay behind the app's adapter boundary; take them from the extension instead.
type ExtensionApi = Parameters<typeof gitGuardrails>[0]
type ToolCall = Parameters<typeof guardToolCall>[0]

const directory = mkdtempSync(path.join(tmpdir(), 'guardrails-extension-'))
mkdirSync(path.join(directory, '.husky'))
writeFileSync(path.join(directory, '.husky', 'pre-push'), '#!/usr/bin/env sh\nbun run verify\n')

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

function call(toolName: string, input: ToolCall['input']) {
  const result: ToolCall = { type: 'tool_call', toolCallId: 'call-1', toolName, input }
  return result
}

describe('git guardrails extension', () => {
  it('registers one tool_call handler', () => {
    const events: string[] = []
    gitGuardrails(fromPartial<ExtensionApi>({ on: (event: string) => events.push(event) }))
    expect(events).toEqual(['tool_call'])
  })

  it('blocks a hook skip and a force push from bash with a reason', () => {
    expect(guardToolCall(call('bash', { command: 'git commit -n -m x' }), directory)).toMatchObject(
      { block: true },
    )
    expect(guardToolCall(call('bash', { command: 'git push --force' }), directory)?.reason).toMatch(
      /^Blocked: /,
    )
  })

  it('allows PR commands and ordinary tool calls', () => {
    expect(
      guardToolCall(call('bash', { command: 'gh pr create --draft && gh pr ready' }), directory),
    ).toBeUndefined()
    expect(guardToolCall(call('read', { path: '.husky/pre-push' }), directory)).toBeUndefined()
    expect(
      guardToolCall(call('write', { path: 'src/a.ts', content: 'exit 0' }), directory),
    ).toBeUndefined()
  })

  it('checks a hook edit against the file on disk', () => {
    const disable = {
      path: '.husky/pre-push',
      edits: [{ oldText: 'bun run verify', newText: 'exit 0' }],
    }
    const extend = {
      path: '.husky/pre-push',
      edits: [{ oldText: 'bun run verify', newText: 'bun run verify\nbun run check:fast' }],
    }
    expect(guardToolCall(call('edit', disable), directory)).toMatchObject({ block: true })
    expect(guardToolCall(call('edit', extend), directory)).toBeUndefined()
    expect(
      guardToolCall(call('edit', { path: '.husky/_/pre-push', edits: [] }), directory),
    ).toMatchObject({ block: true })
  })
})
