import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = path.resolve(import.meta.dirname, '../../src/renderer/src')
const HUB = 'shared/lib/agent-event-hub.ts'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(entryPath)
    return /\.tsx?$/u.test(entry.name) ? [entryPath] : []
  })
}

/**
 * Each `api.onAgentEvent` subscription clones every streamed token across contextBridge again
 * (B13). Renderer code subscribes through the agent event hub, which holds the only one.
 */
describe('renderer agent:event subscriptions', () => {
  it('go through the agent event hub only', () => {
    const offenders = sourceFiles(RENDERER_ROOT)
      .filter((file) => path.relative(RENDERER_ROOT, file) !== HUB)
      .filter((file) => /\.onAgentEvent\(/u.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(RENDERER_ROOT, file))

    expect(offenders).toEqual([])
  })
})
