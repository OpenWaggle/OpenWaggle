import type { ServerTool } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import { withoutApproval } from '../without-approval'

function makeTool(overrides: Partial<ServerTool> & { name: string }): ServerTool {
  return {
    description: `${overrides.name} tool`,
    inputSchema: {},
    execute: async () => ({ kind: 'text' as const, text: 'ok' }),
    ...overrides,
    __toolSide: 'server',
  }
}

describe('withoutApproval', () => {
  it('strips needsApproval from tools that have it', () => {
    const tools = [makeTool({ name: 'writeFile', needsApproval: true })]
    const result = withoutApproval(tools)

    expect(result[0]?.needsApproval).toBe(false)
  })

  it('passes through tools without needsApproval by reference', () => {
    const readTool = makeTool({ name: 'readFile' })
    const result = withoutApproval([readTool])

    expect(result[0]).toBe(readTool)
  })

  it('does NOT mutate the original array or elements', () => {
    const writeTool = makeTool({ name: 'writeFile', needsApproval: true })
    const readTool = makeTool({ name: 'readFile' })
    const original = [writeTool, readTool]

    const result = withoutApproval(original)

    // Original array untouched
    expect(original).toHaveLength(2)
    expect(original[0]?.needsApproval).toBe(true)
    // Result is a new array
    expect(result).not.toBe(original)
    // Original tool object untouched
    expect(writeTool.needsApproval).toBe(true)
  })

  it('returns empty array for empty input', () => {
    expect(withoutApproval([])).toEqual([])
  })

  it('preserves all other properties', () => {
    const tool = makeTool({
      name: 'editFile',
      needsApproval: true,
      description: 'Edit a file',
    })
    const result = withoutApproval([tool])

    expect(result[0]?.name).toBe('editFile')
    expect(result[0]?.description).toBe('Edit a file')
    expect(result[0]?.execute).toBe(tool.execute)
    expect(result[0]?.inputSchema).toBe(tool.inputSchema)
  })
})
