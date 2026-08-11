import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpGatewayResult, McpJsonValue } from '@shared/types/mcp'
import type {
  McpOrchestrationExpression,
  McpOrchestrationProgram,
  McpOrchestrationStatement,
} from './mcp-orchestration-language-types'

export interface McpOrchestrationChildResult {
  readonly id: string
  readonly handle: string
  readonly status: 'completed' | 'failed' | 'denied'
  readonly provenance: {
    readonly handle: string
    readonly serverInstanceId?: string
    readonly serverLabel?: string
    readonly toolName?: string
  }
  readonly result?: McpGatewayResult
  readonly error?: string
}

export interface McpOrchestrationInvocation {
  readonly id: string
  readonly handle: string
  readonly arguments: Readonly<Record<string, McpJsonValue>>
}

export interface McpOrchestrationHost {
  readonly call: (call: McpOrchestrationInvocation) => Promise<McpOrchestrationChildResult>
  readonly parallel: (
    calls: readonly McpOrchestrationInvocation[],
  ) => Promise<readonly McpOrchestrationChildResult[]>
}

export interface McpOrchestrationLimits {
  readonly maxSteps: number
  readonly maxDepth: number
  readonly maxChildCalls: number
  readonly maxMemoryBytes: number
  readonly maxOutputBytes: number
}

export const DEFAULT_MCP_ORCHESTRATION_LIMITS: McpOrchestrationLimits = {
  maxSteps: MCP_CONFIG.MAX_ORCHESTRATION_STEPS,
  maxDepth: MCP_CONFIG.MAX_ORCHESTRATION_DEPTH,
  maxChildCalls: MCP_CONFIG.MAX_ORCHESTRATION_CALLS,
  maxMemoryBytes: MCP_CONFIG.MAX_ORCHESTRATION_MEMORY_BYTES,
  maxOutputBytes: MCP_CONFIG.MAX_ORCHESTRATION_OUTPUT_BYTES,
}

const textEncoder = new TextEncoder()

function jsonBytes(value: unknown) {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('MCP orchestration produced a non-JSON value.')
  return textEncoder.encode(serialized).byteLength
}

function jsonValue(value: unknown): McpJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('MCP orchestration produced a non-JSON value.')
  const parsed: unknown = JSON.parse(serialized)
  return decodeUnknownOrThrow(mcpConfigValueSchema, parsed)
}

function argumentsValue(value: McpJsonValue) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('mcp.call arguments must evaluate to an object.')
  }
  return value
}

function isTruthy(value: McpJsonValue) {
  return value !== null && value !== false && value !== 0 && value !== ''
}

class McpOrchestrationBudget {
  private steps = 0
  private childCalls = 0

  constructor(
    private readonly limits: McpOrchestrationLimits,
    private readonly signal: AbortSignal,
  ) {}

  step() {
    if (this.signal.aborted) {
      throw new Error('MCP orchestration exceeded its wall time or was cancelled.')
    }
    this.steps += 1
    if (this.steps > this.limits.maxSteps) {
      throw new Error(`MCP orchestration exceeded ${String(this.limits.maxSteps)} execution steps.`)
    }
  }

  enterDepth(depth: number) {
    if (depth > this.limits.maxDepth) {
      throw new Error(`MCP orchestration exceeded nesting depth ${String(this.limits.maxDepth)}.`)
    }
  }

  reserveChildCalls(count: number) {
    this.childCalls += count
    if (this.childCalls > this.limits.maxChildCalls) {
      throw new Error(
        `MCP orchestration exceeded ${String(this.limits.maxChildCalls)} child calls.`,
      )
    }
  }

  checkMemory(value: unknown) {
    if (jsonBytes(value) > this.limits.maxMemoryBytes) {
      throw new Error(
        `MCP orchestration exceeded its ${String(this.limits.maxMemoryBytes)} byte memory budget.`,
      )
    }
  }

  checkOutput(value: unknown) {
    if (jsonBytes(value) > this.limits.maxOutputBytes) {
      throw new Error(
        `MCP orchestration exceeded its ${String(this.limits.maxOutputBytes)} byte output budget.`,
      )
    }
  }
}

interface ExecutionFlow {
  readonly returned: boolean
  readonly value: McpJsonValue
}

class McpOrchestrationExecution {
  private readonly variables = new Map<string, McpJsonValue>()
  private readonly results: McpOrchestrationChildResult[] = []
  private readonly budget: McpOrchestrationBudget

  constructor(
    private readonly host: McpOrchestrationHost,
    signal: AbortSignal,
    limits: McpOrchestrationLimits,
  ) {
    this.budget = new McpOrchestrationBudget(limits, signal)
  }

  async run(program: McpOrchestrationProgram) {
    const flow = await this.executeStatements(program.statements, 0)
    const output = { return: flow.value, results: this.results }
    this.budget.checkOutput(output)
    return output
  }

  private bind(name: string, value: McpJsonValue) {
    if (this.variables.has(name))
      throw new Error(`MCP orchestration binding ${name} already exists.`)
    this.variables.set(name, value)
    this.checkWorkingMemory()
  }

  private childValue(result: McpOrchestrationChildResult) {
    this.results.push(result)
    const value = jsonValue(result)
    this.checkWorkingMemory()
    return value
  }

  private checkWorkingMemory() {
    this.budget.checkMemory({ variables: [...this.variables.entries()], results: this.results })
  }

  private async executeStatements(
    statements: readonly McpOrchestrationStatement[],
    depth: number,
  ): Promise<ExecutionFlow> {
    this.budget.enterDepth(depth)
    for (const statement of statements) {
      this.budget.step()
      const flow = await this.executeStatement(statement, depth)
      if (flow.returned) return flow
    }
    return { returned: false, value: null }
  }

  private executeStatement(statement: McpOrchestrationStatement, depth: number) {
    if (statement.type === 'const') {
      this.bind(statement.name, this.evaluate(statement.value, depth + 1))
      return Promise.resolve<ExecutionFlow>({ returned: false, value: null })
    }
    if (statement.type === 'call') return this.executeCall(statement, depth)
    if (statement.type === 'parallel') return this.executeParallel(statement, depth)
    if (statement.type === 'if') {
      return this.executeStatements(
        isTruthy(this.evaluate(statement.condition, depth + 1))
          ? statement.consequent
          : statement.alternate,
        depth + 1,
      )
    }
    if (statement.type === 'return') {
      return Promise.resolve<ExecutionFlow>({
        returned: true,
        value: this.evaluate(statement.value, depth + 1),
      })
    }
    return statement satisfies never
  }

  private async executeCall(
    statement: Extract<McpOrchestrationStatement, { readonly type: 'call' }>,
    depth: number,
  ): Promise<ExecutionFlow> {
    this.budget.reserveChildCalls(1)
    const call = {
      id: statement.call.id,
      handle: statement.call.handle,
      arguments: argumentsValue(this.evaluate(statement.call.arguments, depth + 1)),
    }
    this.bind(statement.name, this.childValue(await this.host.call(call)))
    return { returned: false, value: null }
  }

  private async executeParallel(
    statement: Extract<McpOrchestrationStatement, { readonly type: 'parallel' }>,
    depth: number,
  ): Promise<ExecutionFlow> {
    this.budget.reserveChildCalls(statement.calls.length)
    const calls = statement.calls.map((call) => ({
      id: call.id,
      handle: call.handle,
      arguments: argumentsValue(this.evaluate(call.arguments, depth + 1)),
    }))
    const results = await this.host.parallel(calls)
    if (results.length !== statement.names.length) {
      throw new Error('MCP orchestration host returned an invalid parallel result count.')
    }
    for (const [index, name] of statement.names.entries()) {
      const result = results[index]
      if (!result) throw new Error('MCP orchestration host omitted a parallel result.')
      this.bind(name, this.childValue(result))
    }
    return { returned: false, value: null }
  }

  private evaluate(expression: McpOrchestrationExpression, depth: number): McpJsonValue {
    this.budget.step()
    this.budget.enterDepth(depth)
    if (expression.type === 'literal') return expression.value
    if (expression.type === 'identifier') {
      const value = this.variables.get(expression.name)
      if (value === undefined)
        throw new Error(`Unknown MCP orchestration binding ${expression.name}.`)
      return value
    }
    if (expression.type === 'member') return this.evaluateMember(expression, depth)
    if (expression.type === 'array') {
      return expression.items.map((item) => this.evaluate(item, depth + 1))
    }
    if (expression.type === 'object') {
      const value: Record<string, McpJsonValue> = {}
      for (const entry of expression.entries) {
        value[entry.key] = this.evaluate(entry.value, depth + 1)
      }
      return value
    }
    if (expression.type === 'not') return !isTruthy(this.evaluate(expression.value, depth + 1))
    if (expression.type === 'binary') return this.evaluateBinary(expression, depth)
    return expression satisfies never
  }

  private evaluateMember(
    expression: Extract<McpOrchestrationExpression, { readonly type: 'member' }>,
    depth: number,
  ) {
    const object = this.evaluate(expression.object, depth + 1)
    if (typeof object !== 'object' || object === null || Array.isArray(object)) {
      throw new Error(`Cannot read ${expression.property} from a non-object result.`)
    }
    if (!Object.hasOwn(object, expression.property)) {
      throw new Error(`MCP orchestration result has no property ${expression.property}.`)
    }
    return object[expression.property] ?? null
  }

  private evaluateBinary(
    expression: Extract<McpOrchestrationExpression, { readonly type: 'binary' }>,
    depth: number,
  ) {
    const left = this.evaluate(expression.left, depth + 1)
    if (expression.operator === '&&') {
      return isTruthy(left) && isTruthy(this.evaluate(expression.right, depth + 1))
    }
    if (expression.operator === '||') {
      return isTruthy(left) || isTruthy(this.evaluate(expression.right, depth + 1))
    }
    const equal = Object.is(left, this.evaluate(expression.right, depth + 1))
    return expression.operator === '===' ? equal : !equal
  }
}

export function executeMcpOrchestrationProgram(input: {
  readonly program: McpOrchestrationProgram
  readonly host: McpOrchestrationHost
  readonly signal: AbortSignal
  readonly limits?: McpOrchestrationLimits
}) {
  return new McpOrchestrationExecution(
    input.host,
    input.signal,
    input.limits ?? DEFAULT_MCP_ORCHESTRATION_LIMITS,
  ).run(input.program)
}
