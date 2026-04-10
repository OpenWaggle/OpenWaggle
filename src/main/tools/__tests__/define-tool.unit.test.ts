import os from 'node:os'
import path from 'node:path'
import { Schema } from '@shared/schema'
import { ConversationId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  bindToolContextToTool,
  defineOpenWaggleTool,
  type NormalizedToolResult,
  resolvePath,
} from '../define-tool'
import { withoutApproval } from '../without-approval'

describe('resolvePath', () => {
  it('resolves relative paths against the project root', () => {
    const projectRoot = '/tmp/test-project'
    const resolved = resolvePath(projectRoot, 'src/main/index.ts')
    expect(resolved).toBe(path.resolve(projectRoot, 'src/main/index.ts'))
  })

  it('returns absolute paths as-is', () => {
    const projectRoot = '/tmp/test-project'
    const absolutePath = path.join(os.homedir(), 'other-repo/file.ts')
    const resolved = resolvePath(projectRoot, absolutePath)
    expect(resolved).toBe(absolutePath)
  })

  it('resolves parent traversal relative to project root', () => {
    const projectRoot = '/tmp/test-project'
    const resolved = resolvePath(projectRoot, '../../outside.txt')
    expect(resolved).toBe(path.resolve(projectRoot, '../../outside.txt'))
  })

  it('resolves symlink paths lexically without following them', () => {
    const projectRoot = '/tmp/test-project'
    const resolved = resolvePath(projectRoot, 'linked/secret.txt')
    // path.resolve is purely lexical — symlinks are not followed at resolution time
    expect(resolved).toBe(path.join(projectRoot, 'linked/secret.txt'))
  })
})

describe('NormalizedToolResult types', () => {
  it('supports explicit text result', () => {
    const result: NormalizedToolResult = { kind: 'text', text: 'hello world' }
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.text).toBe('hello world')
    }
  })

  it('supports explicit json result', () => {
    const result: NormalizedToolResult = { kind: 'json', data: { count: 42 } }
    expect(result.kind).toBe('json')
    if (result.kind === 'json') {
      expect(result.data).toEqual({ count: 42 })
    }
  })

  it('text kind result passes through without JSON reinterpretation', () => {
    // A string "42" wrapped in { kind: 'text' } should NOT become a number
    const result: NormalizedToolResult = { kind: 'text', text: '42' }
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(typeof result.text).toBe('string')
      expect(result.text).toBe('42')
    }
  })
})

describe('bindToolContextToTool', () => {
  it('preserves approval overrides after binding context-bound tools', () => {
    const approvalTool = defineOpenWaggleTool({
      name: 'approvalTool',
      description: 'requires approval by default',
      needsApproval: true,
      inputSchema: Schema.Struct({}),
      async execute() {
        return 'ok'
      },
    })

    const [approvalStrippedTool] = withoutApproval([approvalTool])

    const bound = bindToolContextToTool(approvalStrippedTool, {
      conversationId: ConversationId('conv-1'),
      projectPath: '/repo',
    })

    expect(bound.needsApproval).toBe(false)
  })
})
