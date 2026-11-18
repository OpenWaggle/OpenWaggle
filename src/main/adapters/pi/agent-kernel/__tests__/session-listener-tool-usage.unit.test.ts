import { SupportedModelId } from '@shared/types/brand'
import { expect, it, vi } from 'vitest'

const observed = vi.hoisted(() => {
  const toolResults: unknown[] = []
  return { toolResults }
})

vi.mock('../../pi-usage-statistics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pi-usage-statistics')>()),
  observePiToolResultForUsageStatistics: (runId: string, message: unknown) =>
    observed.toolResults.push([runId, message]),
}))

const { createSessionListener } = await import('../session-listener')

it("counts a tool result's own model usage, such as codemode's models.* calls", () => {
  const listener = createSessionListener(
    { model: SupportedModelId('openai/gpt-6'), sessionEntries: null, onEvent: () => {} },
    'run-1',
  )
  const usage = {
    input: 30,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 32,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
  }
  const message = {
    role: 'toolResult' as const,
    toolCallId: 'script-1',
    toolName: 'codemode',
    content: [{ type: 'text' as const, text: 'Script completed' }],
    isError: false,
    usage,
    timestamp: 1,
  }

  listener({ type: 'message_start', message })
  listener({ type: 'message_end', message })

  expect(observed.toolResults).toEqual([['run-1', message]])
})
