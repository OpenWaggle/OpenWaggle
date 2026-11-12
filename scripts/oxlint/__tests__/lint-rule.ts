import type { Context, Plugin, Rule } from '@oxlint/plugins'
import { fromPartial } from '@total-typescript/shoehorn'
import { parseSync, Visitor, type VisitorObject } from 'oxc-parser'

/** A finding as the rule tests assert on it: rule, resolved message and 1-based position. */
export interface LintMessage {
  readonly ruleId: string
  readonly message: string
  readonly line: number
  readonly column: number
}

interface LineColumn {
  readonly line: number
  readonly column: number
}

type ReportDescriptor = Parameters<Context['report']>[0]
type Comment = ReturnType<Context['sourceCode']['getAllComments']>[number]

/** A rule option as JSON, the form a lint config passes it in. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

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

/** oxlint's positions: 1-based lines, 0-based columns. */
function locator(text: string) {
  const lineStarts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') lineStarts.push(index + 1)
  }
  return (offset: number): LineColumn => {
    let line = lineStarts.length - 1
    while (line > 0 && (lineStarts[line] ?? 0) > offset) line -= 1
    return { line: line + 1, column: offset - (lineStarts[line] ?? 0) }
  }
}

function isAstNode(value: unknown): value is object {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  )
}

/** Sets `parent` on every node, as oxlint does for JS plugins; the Program's is null. */
function linkParents(program: object) {
  Reflect.set(program, 'parent', null)
  const pending: { readonly parent: object; readonly value: unknown }[] = [
    { parent: program, value: Object.values(program) },
  ]
  while (true) {
    const next = pending.pop()
    if (next === undefined) return
    const { parent, value } = next
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value
      for (const item of items) pending.push({ parent, value: item })
      continue
    }
    if (!isAstNode(value)) continue
    Reflect.set(value, 'parent', parent)
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'parent') pending.push({ parent: value, value: child })
    }
  }
}

function reportedStart(
  descriptor: ReportDescriptor,
  locate: (offset: number) => LineColumn,
): LineColumn {
  if (descriptor.loc) {
    return 'start' in descriptor.loc ? descriptor.loc.start : descriptor.loc
  }
  if (descriptor.node) {
    return locate(descriptor.node.range[0])
  }
  return { line: 0, column: 0 }
}

/**
 * Lints `code` as `filename` with one rule of `plugin` and returns its findings sorted by
 * position. The source is parsed as TSX with oxc, the parser oxlint uses, into the same ESTree
 * shape oxlint gives JS plugins, and the rule's visitor runs over it in source order.
 *
 * oxlint's own RuleTester cannot run here: it shares a 6 GiB `ArrayBuffer` with the parser, which
 * Bun, the test runtime, does not allow, so it refuses to start on Bun.
 */
export function lintWithRule(
  plugin: Plugin,
  ruleId: string,
  code: string,
  filename: string,
  options: readonly JsonValue[] = [],
): LintMessage[] {
  return runRule(plugin, ruleId, code, filename, options).messages
}

type FixFunction = NonNullable<ReportDescriptor['fix']>
interface RuleFix {
  readonly range: [number, number]
  readonly text: string
}

const FIXER = fromPartial<Parameters<FixFunction>[0]>({
  replaceTextRange: (range: [number, number], text: string) => ({ range, text }),
  replaceText: (node: { range: [number, number] }, text: string) => ({ range: node.range, text }),
  remove: (node: { range: [number, number] }) => ({ range: node.range, text: '' }),
  removeRange: (range: [number, number]) => ({ range, text: '' }),
})

function fixesOf(fix: FixFunction): readonly RuleFix[] {
  const result = fix(FIXER)
  if (result === null || result === undefined) return []
  if ('range' in result) return [result]
  return [...result].filter((item): item is RuleFix => item !== null && item !== undefined)
}

/**
 * Lints `code` with one rule like `lintWithRule` and returns the text after applying every fix
 * the rule reported, as `oxlint --fix` would in one pass.
 */
export function fixWithRule(
  plugin: Plugin,
  ruleId: string,
  code: string,
  filename: string,
  options: readonly JsonValue[] = [],
) {
  const fixes = runRule(plugin, ruleId, code, filename, options)
    .fixes.flatMap(fixesOf)
    .toSorted((left, right) => right.range[0] - left.range[0])
  return fixes.reduce(
    (text, fix) => text.slice(0, fix.range[0]) + fix.text + text.slice(fix.range[1]),
    code,
  )
}

function runRule(
  plugin: Plugin,
  ruleId: string,
  code: string,
  filename: string,
  options: readonly JsonValue[],
) {
  const ruleName = ruleId.slice(ruleId.indexOf('/') + 1)
  const rule = plugin.rules[ruleName]
  const create = rule && 'create' in rule ? rule.create : undefined
  if (!rule || !create) {
    throw new Error(`Unknown rule ${ruleId}`)
  }

  const parsed = parseSync(filename, code, {
    lang: 'tsx',
    sourceType: 'module',
    range: true,
    preserveParens: false,
  })
  const [parseError] = parsed.errors
  if (parseError) {
    throw new Error(`${filename} does not parse: ${parseError.message}`)
  }

  const locate = locator(code)
  const comments = parsed.comments.map((comment): Comment =>
    fromPartial({
      ...comment,
      range: [comment.start, comment.end],
      loc: { start: locate(comment.start), end: locate(comment.end) },
    }),
  )
  const messages: LintMessage[] = []
  const fixes: FixFunction[] = []
  const context = fromPartial<Context>({
    id: ruleId,
    filename,
    physicalFilename: filename,
    options: [...options],
    sourceCode: fromPartial({
      text: code,
      getAllComments: () => comments,
      getLocFromIndex: locate,
    }),
    report: (descriptor: ReportDescriptor) => {
      if (descriptor.fix) fixes.push(descriptor.fix)
      const start = reportedStart(descriptor, locate)
      messages.push({
        ruleId,
        message: resolveMessage(rule, descriptor),
        line: start.line,
        column: start.column + 1,
      })
    },
  })

  const handlers: VisitorObject = Object.fromEntries(
    Object.entries(create(context)).flatMap(([selector, handler]) =>
      typeof handler === 'function'
        ? [
            [
              selector,
              (node: unknown) => {
                Reflect.apply(handler, undefined, [node])
              },
            ],
          ]
        : [],
    ),
  )
  linkParents(parsed.program)
  new Visitor(handlers).visit(parsed.program)

  return {
    messages: messages.toSorted(
      (left, right) => left.line - right.line || left.column - right.column,
    ),
    fixes,
  }
}
