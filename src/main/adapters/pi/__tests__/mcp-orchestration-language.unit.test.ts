import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpJsonValue } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import { parseMcpOrchestration } from '../mcp-orchestration-parser'
import {
  executeMcpOrchestrationProgram,
  type McpOrchestrationChildResult,
  type McpOrchestrationHost,
  type McpOrchestrationInvocation,
  type McpOrchestrationLimits,
} from '../mcp-orchestration-runtime'

const DEFAULT_TEST_LIMITS: McpOrchestrationLimits = {
  maxSteps: 100,
  maxDepth: 8,
  maxChildCalls: 32,
  maxMemoryBytes: 10_000,
  maxOutputBytes: 10_000,
}

function completed(call: McpOrchestrationInvocation): McpOrchestrationChildResult {
  return {
    id: call.id,
    handle: call.handle,
    status: 'completed',
    provenance: { handle: call.handle },
    result: { operation: 'call', text: 'completed', result: call.arguments },
  }
}

function host(): McpOrchestrationHost {
  return {
    call: vi.fn(async (call) => completed(call)),
    parallel: vi.fn(async (calls) => calls.map(completed)),
  }
}

function run(source: string, limits: McpOrchestrationLimits = DEFAULT_TEST_LIMITS) {
  return executeMcpOrchestrationProgram({
    program: parseMcpOrchestration(source),
    host: host(),
    signal: new AbortController().signal,
    limits,
  })
}

describe('restricted MCP orchestration language', () => {
  it('moves child results through variables, conditions, arguments, and return values', async () => {
    const output = await run(`
      const first = await mcp.call("first", "handle-1", { seed: 7 });
      if (first.status === "completed" && first.result.result.seed === 7) {
        const second = await mcp.call("second", "handle-2", { seed: first.result.result.seed });
        return { selected: second.result.result.seed };
      } else {
        return { selected: null };
      }
    `)

    expect(output.return).toEqual({ selected: 7 })
    expect(output.results).toHaveLength(2)
  })

  it.each([
    ['eval', 'const x = eval;'],
    ['Function', 'const x = Function;'],
    ['Node process', 'const x = process.env;'],
    ['module loading', 'const x = require;'],
    ['ambient network', 'const x = fetch;'],
    ['timers', 'const x = setTimeout;'],
    ['dynamic import', 'const x = import;'],
    ['prototype access', 'const x = value.prototype;'],
    ['constructor access', 'const x = value.constructor;'],
    ['prototype object key', 'const x = { __proto__: null };'],
    ['loops', 'while (true) {}'],
    ['functions', 'function x() {}'],
    ['template literals', 'const x = `unsafe`;'],
    ['computed property access', 'const x = value["key"];'],
  ])('rejects forbidden %s syntax', (_label, source) => {
    expect(() => parseMcpOrchestration(source)).toThrow(/Forbidden|Only const|unsupported/u)
  })

  it('enforces child-call, step, depth, memory, output, and cancellation budgets', async () => {
    const twoCalls = `
      const first = await mcp.call("first", "h1", {});
      const second = await mcp.call("second", "h2", {});
    `
    await expect(run(twoCalls, { ...DEFAULT_TEST_LIMITS, maxChildCalls: 1 })).rejects.toThrow(
      'exceeded 1 child calls',
    )
    await expect(
      run('const value = true; return value;', { ...DEFAULT_TEST_LIMITS, maxSteps: 1 }),
    ).rejects.toThrow('exceeded 1 execution steps')
    await expect(
      run('return { nested: { value: true } };', { ...DEFAULT_TEST_LIMITS, maxDepth: 2 }),
    ).rejects.toThrow('nesting depth 2')
    await expect(
      run('const value = "0123456789";', { ...DEFAULT_TEST_LIMITS, maxMemoryBytes: 4 }),
    ).rejects.toThrow('4 byte memory budget')
    await expect(
      run('return "0123456789";', { ...DEFAULT_TEST_LIMITS, maxOutputBytes: 4 }),
    ).rejects.toThrow('4 byte output budget')

    const controller = new AbortController()
    controller.abort()
    await expect(
      executeMcpOrchestrationProgram({
        program: parseMcpOrchestration('return true;'),
        host: host(),
        signal: controller.signal,
        limits: DEFAULT_TEST_LIMITS,
      }),
    ).rejects.toThrow('wall time or was cancelled')
  })

  it('rejects static source, call-count, and nesting excess before execution', () => {
    const calls = Array.from(
      { length: 33 },
      (_, index) =>
        `const call_${String(index)} = await mcp.call("id-${String(index)}", "handle", {});`,
    ).join('\n')
    expect(() =>
      parseMcpOrchestration(' '.repeat(MCP_CONFIG.MAX_ORCHESTRATION_SOURCE_BYTES + 1)),
    ).toThrow('source exceeded 64000 bytes')
    expect(() => parseMcpOrchestration(calls)).toThrow('child calls exceeded 32')
    expect(() => parseMcpOrchestration(`return ${'!'.repeat(10)}true;`)).toThrow(
      'nesting exceeded 8',
    )
  })

  it('requires call arguments to remain JSON objects', async () => {
    const invalidArgument: McpJsonValue = ['not', 'an', 'object']
    await expect(
      run(`const result = await mcp.call("id", "handle", ${JSON.stringify(invalidArgument)});`),
    ).rejects.toThrow('arguments must evaluate to an object')
  })
})
