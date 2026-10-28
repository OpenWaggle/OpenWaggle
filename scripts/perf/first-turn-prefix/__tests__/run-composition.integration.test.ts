import { tmpdir } from 'node:os'
import type { ExtensionFactory, InlineExtension } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import { fromPartial } from '@total-typescript/shoehorn'
import type { McpConnectionPool } from '../../../../src/main/adapters/mcp/pool/mcp-connection-pool-api'
import { composeFirstTurnRun } from '../run-composition'

/**
 * R6 P3-3: the first-turn prefix budget measures the Run the Host builds, not a hand-kept copy of
 * it. Each production builder below gets one extra extension or appendix; the measured composition
 * must carry all of them, so whatever the Run path adds is counted against the budget.
 */
const INLINE_SENTINEL: InlineExtension = () => undefined
const TRUSTED_SENTINEL: ExtensionFactory = () => undefined
const APPENDIX_SENTINEL = 'appendix added to the real Run path'

vi.mock('electron', () => ({
  app: { getPath: () => process.env.OPENWAGGLE_USER_DATA_DIR ?? tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {},
}))

vi.mock('../../../../src/main/adapters/pi/mcp/openwaggle-mcp-extensions', () => ({
  createOpenWaggleMcpExtensions: async () => [],
}))

vi.mock('../../../../src/main/adapters/pi/agent-kernel/classic-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/adapters/pi/agent-kernel/classic-run')>()
  return {
    ...actual,
    classicRunInlineExtensions: (input: Parameters<typeof actual.classicRunInlineExtensions>[0]) => {
      const built = actual.classicRunInlineExtensions(input)
      return { ...built, extensionFactories: [...built.extensionFactories, INLINE_SENTINEL] }
    },
  }
})

vi.mock('../../../../src/main/adapters/pi/pi-agent-kernel-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/adapters/pi/pi-agent-kernel-run')>()
  return {
    ...actual,
    createRunTrustedExtensionFactories: (input: Parameters<typeof actual.createRunTrustedExtensionFactories>[0]) => [
      ...actual.createRunTrustedExtensionFactories(input),
      TRUSTED_SENTINEL,
    ],
  }
})

vi.mock('../../../../src/main/adapters/pi/agent-kernel/run-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/adapters/pi/agent-kernel/run-lifecycle')>()
  return {
    ...actual,
    runSystemPromptAppendices: (...args: Parameters<typeof actual.runSystemPromptAppendices>) => {
      const built = actual.runSystemPromptAppendices(...args)
      return { systemPromptAppendices: [...(built.systemPromptAppendices ?? []), APPENDIX_SENTINEL] }
    },
  }
})

describe('first-turn prefix Run composition', () => {
  it('is built by the Run path builders, so what they add is measured', async () => {
    const composed = await composeFirstTurnRun({
      projectPath: '/tmp/project',
      role: 'independent',
      sessionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      runId: '0d8bec21-9e09-4ace-bb66-66b1677cc926',
      modelId: 'prefix-model',
      browserPreview: true,
      scratchDirectory: '/tmp/ow-scratch-501/19fa3e03/ddee1ba606f3',
      visualizationDirectory: '/tmp/visualizations/7c9e6679',
      docsBundlePath: '/Applications/OpenWaggle.app/Contents/Resources/openwaggle-docs',
      mcpPool: fromPartial<McpConnectionPool>({}),
    })

    expect(composed.extensionFactories).toContain(INLINE_SENTINEL)
    expect(composed.trustedExtensionFactories).toContain(TRUSTED_SENTINEL)
    expect(composed.systemPromptAppendices.at(-1)).toBe(APPENDIX_SENTINEL)
    // The scratch guidance names the evidence directory the Host prepares before a Run.
    expect(composed.systemPromptAppendices[0]).toContain('$OPENWAGGLE_EVIDENCE_DIR')
  })
})
