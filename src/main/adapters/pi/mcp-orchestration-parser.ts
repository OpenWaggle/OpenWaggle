import { MCP_CONFIG } from '@shared/constants/mcp'
import {
  FORBIDDEN_ORCHESTRATION_IDENTIFIERS,
  McpOrchestrationExpressionParser,
  orchestrationSyntaxError,
} from './mcp-orchestration-expression-parser'
import type {
  McpOrchestrationCall,
  McpOrchestrationExpression,
  McpOrchestrationProgram,
  McpOrchestrationStatement,
} from './mcp-orchestration-language-types'
import { tokenizeMcpOrchestration } from './mcp-orchestration-tokenizer'

const FORBIDDEN_STATEMENTS = new Set([
  'class',
  'do',
  'export',
  'for',
  'function',
  'new',
  'switch',
  'throw',
  'try',
  'while',
  'with',
])

class McpOrchestrationParser extends McpOrchestrationExpressionParser {
  private readonly callIds = new Set<string>()
  private readonly bindings = new Set<string>()

  private declareBinding(name: string) {
    if (FORBIDDEN_ORCHESTRATION_IDENTIFIERS.has(name) || name === 'mcp') {
      throw orchestrationSyntaxError(this.current(), `Forbidden binding ${name}.`)
    }
    if (this.bindings.has(name)) {
      throw orchestrationSyntaxError(this.current(), `Duplicate binding ${name}.`)
    }
    this.bindings.add(name)
  }

  private registerCall(id: string) {
    if (!id.trim()) {
      throw orchestrationSyntaxError(this.current(), 'MCP child call ids cannot be empty.')
    }
    if (this.callIds.has(id)) {
      throw orchestrationSyntaxError(this.current(), `Duplicate MCP child call id ${id}.`)
    }
    this.callIds.add(id)
    if (this.callIds.size > MCP_CONFIG.MAX_ORCHESTRATION_CALLS) {
      throw new Error(
        `MCP orchestration child calls exceeded ${String(MCP_CONFIG.MAX_ORCHESTRATION_CALLS)}.`,
      )
    }
  }

  parse(): McpOrchestrationProgram {
    const statements = this.statements(0, false)
    this.expect('')
    return { statements }
  }

  private statements(depth: number, block: boolean) {
    this.assertDepth(depth)
    const statements: McpOrchestrationStatement[] = []
    while (this.current().kind !== 'eof' && (!block || this.current().value !== '}')) {
      statements.push(this.statement(depth))
    }
    return statements
  }

  private statement(depth: number): McpOrchestrationStatement {
    const token = this.current()
    if (
      FORBIDDEN_STATEMENTS.has(token.value) ||
      FORBIDDEN_ORCHESTRATION_IDENTIFIERS.has(token.value)
    ) {
      throw orchestrationSyntaxError(token, `Forbidden statement or authority ${token.value}.`)
    }
    if (token.value === 'const') return this.constStatement(depth)
    if (token.value === 'if') return this.ifStatement(depth)
    if (token.value === 'return') {
      this.consume()
      const value = this.expression(depth + 1)
      this.expect(';')
      return { type: 'return', value }
    }
    throw orchestrationSyntaxError(token, 'Only const, if/else, and return statements are allowed.')
  }

  private constStatement(depth: number): McpOrchestrationStatement {
    this.expect('const')
    if (this.matches('[')) return this.parallelStatement(depth)
    const name = this.identifier()
    this.declareBinding(name)
    this.expect('=')
    if (this.matches('await')) {
      const call = this.awaitCall(depth + 1)
      this.expect(';')
      return { type: 'call', name, call }
    }
    const value = this.expression(depth + 1)
    this.expect(';')
    return { type: 'const', name, value }
  }

  private parallelStatement(depth: number): McpOrchestrationStatement {
    const names: string[] = []
    do {
      const name = this.identifier()
      this.declareBinding(name)
      names.push(name)
    } while (this.matches(','))
    this.expect(']')
    this.expect('=')
    this.expect('await')
    this.expect('mcp')
    this.expect('.')
    this.expect('parallel')
    this.expect('(')
    this.expect('[')
    const calls: McpOrchestrationCall[] = []
    if (this.current().value !== ']') {
      do calls.push(this.inlineCall(depth + 1))
      while (this.matches(','))
    }
    this.expect(']')
    this.expect(')')
    this.expect(';')
    if (calls.length === 0) {
      throw orchestrationSyntaxError(this.current(), 'Parallel groups cannot be empty.')
    }
    if (names.length !== calls.length) {
      throw orchestrationSyntaxError(
        this.current(),
        'Parallel result bindings must match the child call count.',
      )
    }
    return { type: 'parallel', names, calls }
  }

  private awaitCall(depth: number) {
    this.expect('mcp')
    this.expect('.')
    if (this.current().value === 'parallel') {
      throw orchestrationSyntaxError(this.current(), 'Parallel groups require array destructuring.')
    }
    return this.callArguments(depth)
  }

  private inlineCall(depth: number) {
    this.expect('mcp')
    this.expect('.')
    return this.callArguments(depth)
  }

  private callArguments(depth: number): McpOrchestrationCall {
    this.expect('call')
    this.expect('(')
    const id = this.stringLiteral('child call id')
    this.expect(',')
    const handle = this.stringLiteral('MCP handle')
    const arguments_ = this.matches(',')
      ? this.expression(depth + 1)
      : ({ type: 'literal', value: {} } satisfies McpOrchestrationExpression)
    this.expect(')')
    if (!handle.trim()) {
      throw orchestrationSyntaxError(this.current(), 'MCP handles cannot be empty.')
    }
    this.registerCall(id)
    return { id, handle, arguments: arguments_ }
  }

  private ifStatement(depth: number): McpOrchestrationStatement {
    this.expect('if')
    this.expect('(')
    const condition = this.expression(depth + 1)
    this.expect(')')
    const consequent = this.block(depth + 1)
    const alternate = this.matches('else') ? this.block(depth + 1) : []
    return { type: 'if', condition, consequent, alternate }
  }

  private block(depth: number) {
    this.assertDepth(depth)
    this.expect('{')
    const statements = this.statements(depth, true)
    this.expect('}')
    return statements
  }
}

export function parseMcpOrchestration(source: string) {
  return new McpOrchestrationParser(tokenizeMcpOrchestration(source)).parse()
}
