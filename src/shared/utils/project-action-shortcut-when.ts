import { match, matchBy } from '@diegogbrisa/ts-match'
import { PROJECT_ACTION_LIMITS } from '@shared/types/project-actions'

export type ProjectActionWhenNode =
  | { readonly type: 'identifier'; readonly name: string }
  | { readonly type: 'not'; readonly node: ProjectActionWhenNode }
  | {
      readonly type: 'and'
      readonly left: ProjectActionWhenNode
      readonly right: ProjectActionWhenNode
    }
  | {
      readonly type: 'or'
      readonly left: ProjectActionWhenNode
      readonly right: ProjectActionWhenNode
    }

type WhenToken =
  | { readonly type: 'identifier'; readonly value: string }
  | { readonly type: 'not' }
  | { readonly type: 'and' }
  | { readonly type: 'or' }
  | { readonly type: 'lparen' }
  | { readonly type: 'rparen' }

export interface ProjectActionShortcutContext {
  readonly terminalFocus: boolean
  readonly terminalOpen: boolean
  readonly previewFocus: boolean
  readonly previewOpen: boolean
  readonly modelPickerOpen: boolean
  readonly [key: string]: boolean
}

const BOOLEAN_OPERATOR_CHARACTER_COUNT = 2
const whenExpressionCache = new Map<string, ProjectActionWhenNode | null>()

function tokenizeWhenExpression(expression: string): WhenToken[] | null {
  const tokens: WhenToken[] = []
  let index = 0

  while (index < expression.length) {
    const current = expression[index]
    if (current === undefined) break
    if (/\s/.test(current)) {
      index += 1
      continue
    }
    if (expression.startsWith('&&', index)) {
      tokens.push({ type: 'and' })
      index += BOOLEAN_OPERATOR_CHARACTER_COUNT
      continue
    }
    if (expression.startsWith('||', index)) {
      tokens.push({ type: 'or' })
      index += BOOLEAN_OPERATOR_CHARACTER_COUNT
      continue
    }
    if (current === '!') {
      tokens.push({ type: 'not' })
      index += 1
      continue
    }
    if (current === '(') {
      tokens.push({ type: 'lparen' })
      index += 1
      continue
    }
    if (current === ')') {
      tokens.push({ type: 'rparen' })
      index += 1
      continue
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expression.slice(index))
    if (identifier === null) return null
    const value = identifier[0]
    if (value === undefined) return null
    tokens.push({ type: 'identifier', value })
    index += value.length
  }

  return tokens
}

/** Parses T3-compatible boolean `when` expressions. */
export function parseProjectActionWhenExpression(expression: string): ProjectActionWhenNode | null {
  const tokens = tokenizeWhenExpression(expression)
  if (tokens === null || tokens.length === 0) return null
  let index = 0

  const parsePrimary = (depth: number): ProjectActionWhenNode | null => {
    if (depth > PROJECT_ACTION_LIMITS.SHORTCUT_WHEN_DEPTH) return null
    const token = tokens[index]
    if (token === undefined) return null

    return matchBy(token, 'type')
      .with('identifier', (identifier) => {
        index += 1
        return { type: 'identifier', name: identifier.value }
      })
      .with('lparen', () => {
        index += 1
        const expressionNode = parseOr(depth + 1)
        const closeToken = tokens[index]
        if (expressionNode === null || closeToken?.type !== 'rparen') return null
        index += 1
        return expressionNode
      })
      .with('not', 'and', 'or', 'rparen', () => null)
      .exhaustive()
  }

  const parseUnary = (depth: number): ProjectActionWhenNode | null => {
    let notCount = 0
    while (tokens[index]?.type === 'not') {
      index += 1
      notCount += 1
      if (notCount > PROJECT_ACTION_LIMITS.SHORTCUT_WHEN_DEPTH) return null
    }

    let node = parsePrimary(depth)
    if (node === null) return null
    while (notCount > 0) {
      node = { type: 'not', node }
      notCount -= 1
    }
    return node
  }

  const parseAnd = (depth: number): ProjectActionWhenNode | null => {
    let left = parseUnary(depth)
    if (left === null) return null
    while (tokens[index]?.type === 'and') {
      index += 1
      const right = parseUnary(depth)
      if (right === null) return null
      left = { type: 'and', left, right }
    }
    return left
  }

  const parseOr = (depth: number): ProjectActionWhenNode | null => {
    let left = parseAnd(depth)
    if (left === null) return null
    while (tokens[index]?.type === 'or') {
      index += 1
      const right = parseAnd(depth)
      if (right === null) return null
      left = { type: 'or', left, right }
    }
    return left
  }

  const ast = parseOr(0)
  return ast !== null && index === tokens.length ? ast : null
}

function wrappedProjectActionWhenExpression(node: ProjectActionWhenNode) {
  const expression = formatProjectActionWhenExpression(node)
  return node.type === 'and' || node.type === 'or' ? `(${expression})` : expression
}

/** Serializes the condition AST without changing its boolean meaning. */
export function formatProjectActionWhenExpression(node: ProjectActionWhenNode): string {
  return match(node.type)
    .with('identifier', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      return node.name
    })
    .with('not', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      return `!${wrappedProjectActionWhenExpression(node.node)}`
    })
    .with('and', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      return `${wrappedProjectActionWhenExpression(node.left)} && ${wrappedProjectActionWhenExpression(node.right)}`
    })
    .with('or', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      return `${wrappedProjectActionWhenExpression(node.left)} || ${wrappedProjectActionWhenExpression(node.right)}`
    })
    .exhaustive()
}

function cachedWhenExpression(expression: string) {
  const cached = whenExpressionCache.get(expression)
  if (cached !== undefined) return cached
  const parsed = parseProjectActionWhenExpression(expression)
  if (whenExpressionCache.size >= PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT) {
    const oldest = whenExpressionCache.keys().next().value
    if (oldest !== undefined) whenExpressionCache.delete(oldest)
  }
  whenExpressionCache.set(expression, parsed)
  return parsed
}

export function evaluateProjectActionWhen(
  node: ProjectActionWhenNode,
  context: ProjectActionShortcutContext,
): boolean {
  return match(node.type)
    .with('identifier', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      if (node.name === 'true') return true
      if (node.name === 'false') return false
      return context[node.name] ?? false
    })
    .with('not', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      return !evaluateProjectActionWhen(node.node, context)
    })
    .with('and', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      return (
        evaluateProjectActionWhen(node.left, context) &&
        evaluateProjectActionWhen(node.right, context)
      )
    })
    .with('or', (type) => {
      if (node.type !== type) throw new Error('Project Action condition node type changed.')
      return (
        evaluateProjectActionWhen(node.left, context) ||
        evaluateProjectActionWhen(node.right, context)
      )
    })
    .exhaustive()
}

export function projectActionWhenMatches(
  when: string | undefined,
  context: ProjectActionShortcutContext,
) {
  const expression = when?.trim() ?? ''
  if (expression.length === 0) return true
  const parsed = cachedWhenExpression(expression)
  return parsed !== null && evaluateProjectActionWhen(parsed, context)
}

/** Returns the distinct identifiers in a valid condition, or null for malformed input. */
export function projectActionWhenIdentifiers(expression: string): readonly string[] | null {
  const parsed = parseProjectActionWhenExpression(expression)
  if (parsed === null) return null
  const identifiers = new Set<string>()
  const pending: ProjectActionWhenNode[] = [parsed]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    match(node.type)
      .with('identifier', (type) => {
        if (node.type !== type) throw new Error('Project Action condition node type changed.')
        identifiers.add(node.name)
      })
      .with('not', (type) => {
        if (node.type !== type) throw new Error('Project Action condition node type changed.')
        pending.push(node.node)
      })
      .with('and', 'or', (type) => {
        if (node.type !== type) throw new Error('Project Action condition node type changed.')
        pending.push(node.right, node.left)
      })
      .exhaustive()
  }
  return [...identifiers]
}
