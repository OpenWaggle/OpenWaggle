import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpJsonValue } from '@shared/types/mcp'
import type { McpOrchestrationExpression } from './mcp-orchestration-language-types'
import type { McpOrchestrationToken } from './mcp-orchestration-tokenizer'

export const FORBIDDEN_ORCHESTRATION_IDENTIFIERS = new Set([
  'Buffer',
  'Bun',
  'Deno',
  'Function',
  'WebSocket',
  'XMLHttpRequest',
  'child_process',
  'electron',
  'eval',
  'fetch',
  'fs',
  'global',
  'globalThis',
  'import',
  'module',
  'process',
  'queueMicrotask',
  'require',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'this',
])

export const FORBIDDEN_ORCHESTRATION_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype'])

export function orchestrationSyntaxError(token: McpOrchestrationToken, message: string) {
  return new Error(`Invalid MCP orchestration syntax at offset ${String(token.offset)}: ${message}`)
}

export class McpOrchestrationExpressionParser {
  protected index = 0

  constructor(protected readonly tokens: readonly McpOrchestrationToken[]) {}

  protected current() {
    return this.tokens[this.index] ?? { kind: 'eof' as const, value: '', offset: 0 }
  }

  protected consume() {
    const token = this.current()
    this.index += 1
    return token
  }

  protected matches(value: string) {
    if (this.current().value !== value) return false
    this.consume()
    return true
  }

  protected expect(value: string) {
    const token = this.current()
    if (token.value !== value) {
      throw orchestrationSyntaxError(token, `Expected ${value || 'end of input'}.`)
    }
    return this.consume()
  }

  protected identifier(expected?: string) {
    const token = this.current()
    if (token.kind !== 'identifier' || (expected !== undefined && token.value !== expected)) {
      throw orchestrationSyntaxError(token, `Expected ${expected ?? 'an identifier'}.`)
    }
    this.consume()
    return token.value
  }

  protected assertDepth(depth: number) {
    if (depth > MCP_CONFIG.MAX_ORCHESTRATION_DEPTH) {
      throw new Error(
        `MCP orchestration nesting exceeded ${String(MCP_CONFIG.MAX_ORCHESTRATION_DEPTH)}.`,
      )
    }
  }

  protected stringLiteral(label: string) {
    const token = this.current()
    if (token.kind !== 'string') {
      throw orchestrationSyntaxError(token, `Expected a literal ${label}.`)
    }
    this.consume()
    return token.value
  }

  protected expression(depth: number): McpOrchestrationExpression {
    return this.orExpression(depth)
  }

  private orExpression(depth: number): McpOrchestrationExpression {
    let expression = this.andExpression(depth)
    while (this.matches('||')) {
      expression = {
        type: 'binary',
        operator: '||',
        left: expression,
        right: this.andExpression(depth),
      }
    }
    return expression
  }

  private andExpression(depth: number): McpOrchestrationExpression {
    let expression = this.equalityExpression(depth)
    while (this.matches('&&')) {
      expression = {
        type: 'binary',
        operator: '&&',
        left: expression,
        right: this.equalityExpression(depth),
      }
    }
    return expression
  }

  private equalityExpression(depth: number): McpOrchestrationExpression {
    let expression = this.unaryExpression(depth)
    while (this.current().value === '===' || this.current().value === '!==') {
      const operator = this.consume().value === '===' ? '===' : '!=='
      expression = {
        type: 'binary',
        operator,
        left: expression,
        right: this.unaryExpression(depth),
      }
    }
    return expression
  }

  private unaryExpression(depth: number): McpOrchestrationExpression {
    if (this.matches('!')) return { type: 'not', value: this.unaryExpression(depth + 1) }
    return this.memberExpression(depth)
  }

  private memberExpression(depth: number): McpOrchestrationExpression {
    let expression = this.primaryExpression(depth)
    let memberDepth = depth
    while (this.matches('.')) {
      memberDepth += 1
      this.assertDepth(memberDepth)
      const property = this.identifier()
      if (FORBIDDEN_ORCHESTRATION_PROPERTIES.has(property)) {
        throw orchestrationSyntaxError(this.current(), `Forbidden property access ${property}.`)
      }
      expression = { type: 'member', object: expression, property }
    }
    if (this.current().value === '[') {
      throw orchestrationSyntaxError(this.current(), 'Forbidden computed property access.')
    }
    return expression
  }

  private primaryExpression(depth: number): McpOrchestrationExpression {
    this.assertDepth(depth)
    const token = this.current()
    if (token.kind === 'string' || token.kind === 'number') {
      this.consume()
      return { type: 'literal', value: token.kind === 'number' ? Number(token.value) : token.value }
    }
    if (token.value === 'true' || token.value === 'false' || token.value === 'null') {
      this.consume()
      const value: McpJsonValue = token.value === 'null' ? null : token.value === 'true'
      return { type: 'literal', value }
    }
    if (this.matches('[')) return this.arrayExpression(depth + 1)
    if (this.matches('{')) return this.objectExpression(depth + 1)
    if (this.matches('(')) {
      const expression = this.expression(depth + 1)
      this.expect(')')
      return expression
    }
    if (token.kind === 'identifier') {
      if (FORBIDDEN_ORCHESTRATION_IDENTIFIERS.has(token.value) || token.value === 'mcp') {
        throw orchestrationSyntaxError(token, `Forbidden authority ${token.value}.`)
      }
      this.consume()
      return { type: 'identifier', name: token.value }
    }
    throw orchestrationSyntaxError(token, 'Expected an orchestration expression.')
  }

  private arrayExpression(depth: number): McpOrchestrationExpression {
    const items: McpOrchestrationExpression[] = []
    if (this.current().value !== ']') {
      do items.push(this.expression(depth))
      while (this.matches(','))
    }
    this.expect(']')
    return { type: 'array', items }
  }

  private objectExpression(depth: number): McpOrchestrationExpression {
    const entries: { readonly key: string; readonly value: McpOrchestrationExpression }[] = []
    const keys = new Set<string>()
    if (this.current().value !== '}') {
      do {
        const token = this.current()
        const key = token.kind === 'string' ? this.stringLiteral('object key') : this.identifier()
        if (FORBIDDEN_ORCHESTRATION_PROPERTIES.has(key)) {
          throw orchestrationSyntaxError(token, `Forbidden object key ${key}.`)
        }
        if (keys.has(key)) throw orchestrationSyntaxError(token, `Duplicate object key ${key}.`)
        keys.add(key)
        this.expect(':')
        entries.push({ key, value: this.expression(depth) })
      } while (this.matches(','))
    }
    this.expect('}')
    return { type: 'object', entries }
  }
}
