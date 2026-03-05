import { ConversationId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { runWithToolContext } from '../tools/define-tool'
import { buildExecutorTools } from './executor-tools'

function getToolByName(tools: readonly { name?: string; needsApproval?: boolean }[], name: string) {
  return tools.find((tool) => tool.name === name)
}

function maybeGetExecute(tool: unknown): ((args: unknown) => Promise<unknown>) | null {
  if (!tool || typeof tool !== 'object') {
    return null
  }
  if (!('execute' in tool)) {
    return null
  }
  const execute: unknown = tool.execute
  if (typeof execute !== 'function') {
    return null
  }
  return async (args: unknown): Promise<unknown> => execute(args)
}

describe('buildExecutorTools', () => {
  it('strips approvals from trustable tools in full-access mode', () => {
    const tools = buildExecutorTools('full-access', {})
    const writeFile = getToolByName(tools, 'writeFile')
    const editFile = getToolByName(tools, 'editFile')
    const runCommand = getToolByName(tools, 'runCommand')
    const webFetch = getToolByName(tools, 'webFetch')

    expect(writeFile?.needsApproval).toBe(false)
    expect(editFile?.needsApproval).toBe(false)
    expect(runCommand?.needsApproval).toBe(false)
    expect(webFetch?.needsApproval).toBe(false)
  })

  it('blocks untrusted command execution in default-permissions mode', async () => {
    const tools = buildExecutorTools('default-permissions', {})
    const runCommand = getToolByName(tools, 'runCommand')
    const execute = maybeGetExecute(runCommand)
    if (!execute) {
      throw new Error('Expected runCommand executor')
    }

    const result = await execute({ command: 'pnpm test' })
    expect(result).toEqual({
      kind: 'json',
      data: {
        ok: false,
        error:
          'Default permissions blocked runCommand in orchestration. Approve a matching command in chat to trust this command pattern.',
      },
    })
  })

  it('executes trusted commands in default-permissions mode', async () => {
    const tools = buildExecutorTools('default-permissions', {
      approvals: {
        tools: {
          runCommand: {
            allowPatterns: [{ pattern: 'echo*' }],
          },
        },
      },
    })
    const runCommand = getToolByName(tools, 'runCommand')
    const execute = maybeGetExecute(runCommand)
    if (!execute) {
      throw new Error('Expected runCommand executor')
    }

    const result = await runWithToolContext(
      {
        conversationId: ConversationId('executor-tools-test'),
        projectPath: process.cwd(),
      },
      () => execute({ command: 'echo executor-tools' }),
    )

    expect(result).toEqual({
      kind: 'text',
      text: 'executor-tools',
    })
  })
})
