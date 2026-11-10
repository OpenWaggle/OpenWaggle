import type { Context, Plugin, Rule } from '@oxlint/plugins'
import { RuleTester } from 'oxlint/plugins-dev'

/** A finding as the rule tests assert on it: rule, resolved message and 1-based position. */
export interface LintMessage {
  readonly ruleId: string
  readonly message: string
  readonly line: number
  readonly column: number
}

interface ReportedPosition {
  readonly line: number
  readonly column: number
}

type ReportDescriptor = Parameters<Context['report']>[0]

/** A rule option as JSON, the form a lint config passes it in. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// RuleTester registers a describe/it per case; run them inline so each `lint()` call parses and
// lints synchronously inside the calling test.
RuleTester.describe = (_name, run) => run()
RuleTester.it = (_name, run) => run()

const tester = new RuleTester({
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'tsx' } },
})

function messageTemplate(rule: Rule, descriptor: ReportDescriptor) {
  if (descriptor.messageId) {
    return rule.meta?.messages?.[descriptor.messageId] ?? ''
  }
  return descriptor.message ?? ''
}

function resolveMessage(rule: Rule, descriptor: ReportDescriptor) {
  const data = descriptor.data ?? {}
  return messageTemplate(rule, descriptor).replaceAll(
    /\{\{\s*(\w+)\s*\}\}/g,
    (placeholder: string, key: string) => (key in data ? String(data[key]) : placeholder),
  )
}

function reportedStart(context: Context, descriptor: ReportDescriptor): ReportedPosition {
  if (descriptor.loc) {
    return 'start' in descriptor.loc ? descriptor.loc.start : descriptor.loc
  }
  if (descriptor.node) {
    return context.sourceCode.getLocFromIndex(descriptor.node.range[0])
  }
  return { line: 0, column: 0 }
}

/**
 * Lints `code` as `filename` with one rule of `plugin` and returns its findings sorted by
 * position. The rule runs inside oxlint's RuleTester; its reports are collected instead of
 * asserted, so tests keep asserting on messages the way they did with ESLint's Linter.
 */
export function lintWithRule(
  plugin: Plugin,
  ruleId: string,
  code: string,
  filename: string,
  options: readonly JsonValue[] = [],
): LintMessage[] {
  const ruleName = ruleId.slice(ruleId.indexOf('/') + 1)
  const rule = plugin.rules[ruleName]
  const create = rule && 'create' in rule ? rule.create : undefined
  if (!rule || !create) {
    throw new Error(`Unknown rule ${ruleId}`)
  }

  const messages: LintMessage[] = []
  const collectingRule: Rule = {
    ...rule,
    create(context) {
      // The context is frozen, so the proxy wraps a copy and forwards every other key to it.
      const collectingContext = new Proxy<Context>({ ...context }, {
        get(_target, key) {
          if (key === 'report') {
            return (descriptor: ReportDescriptor) => {
              const start = reportedStart(context, descriptor)
              messages.push({
                ruleId,
                message: resolveMessage(rule, descriptor),
                line: start.line,
                column: start.column + 1,
              })
            }
          }
          const value: unknown = Reflect.get(context, key, context)
          if (typeof value !== 'function') {
            return value
          }
          return (...args: unknown[]) => {
            const result: unknown = Reflect.apply(value, context, args)
            return result
          }
        },
      })
      return create(collectingContext)
    },
  }

  tester.run(ruleId, collectingRule, {
    valid: [options.length > 0 ? { code, filename, options: [...options] } : { code, filename }],
    invalid: [],
  })

  return messages.toSorted((left, right) => left.line - right.line || left.column - right.column)
}
