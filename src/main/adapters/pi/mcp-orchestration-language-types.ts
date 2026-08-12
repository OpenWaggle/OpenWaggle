import type { McpJsonValue } from '@shared/types/mcp'

export type McpOrchestrationExpression =
  | { readonly type: 'literal'; readonly value: McpJsonValue }
  | { readonly type: 'identifier'; readonly name: string }
  | {
      readonly type: 'member'
      readonly object: McpOrchestrationExpression
      readonly property: string
    }
  | { readonly type: 'array'; readonly items: readonly McpOrchestrationExpression[] }
  | {
      readonly type: 'object'
      readonly entries: readonly {
        readonly key: string
        readonly value: McpOrchestrationExpression
      }[]
    }
  | { readonly type: 'not'; readonly value: McpOrchestrationExpression }
  | {
      readonly type: 'binary'
      readonly operator: '===' | '!==' | '&&' | '||'
      readonly left: McpOrchestrationExpression
      readonly right: McpOrchestrationExpression
    }

export interface McpOrchestrationCall {
  readonly id: string
  readonly handle: string
  readonly arguments: McpOrchestrationExpression
}

export type McpOrchestrationStatement =
  | {
      readonly type: 'const'
      readonly name: string
      readonly value: McpOrchestrationExpression
    }
  | {
      readonly type: 'call'
      readonly name: string
      readonly call: McpOrchestrationCall
    }
  | {
      readonly type: 'parallel'
      readonly names: readonly string[]
      readonly calls: readonly McpOrchestrationCall[]
    }
  | {
      readonly type: 'if'
      readonly condition: McpOrchestrationExpression
      readonly consequent: readonly McpOrchestrationStatement[]
      readonly alternate: readonly McpOrchestrationStatement[]
    }
  | { readonly type: 'return'; readonly value: McpOrchestrationExpression }

export interface McpOrchestrationProgram {
  readonly statements: readonly McpOrchestrationStatement[]
}
