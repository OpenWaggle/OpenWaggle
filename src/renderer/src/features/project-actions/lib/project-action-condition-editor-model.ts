import type { ProjectActionWhenNode } from '@shared/utils/project-action-shortcuts'

export type BooleanOperator = 'and' | 'or'

const DEFAULT_WHEN_VARIABLE = 'terminalFocus'

export interface ConditionParts {
  readonly identifier: string
  readonly negated: boolean
}

export function booleanOperator(value: string): BooleanOperator | null {
  if (value === 'and' || value === 'or') return value
  return null
}

export function flattenConditionChildren(
  node: ProjectActionWhenNode,
  operator: BooleanOperator,
): readonly ProjectActionWhenNode[] {
  if (node.type !== operator) return [node]
  return [
    ...flattenConditionChildren(node.left, operator),
    ...flattenConditionChildren(node.right, operator),
  ]
}

export function buildConditionGroup(
  children: readonly ProjectActionWhenNode[],
  operator: BooleanOperator,
): ProjectActionWhenNode | undefined {
  const first = children[0]
  if (first === undefined) return undefined
  return children
    .slice(1)
    .reduce<ProjectActionWhenNode>((left, right) => ({ type: operator, left, right }), first)
}

export function projectActionConditionParts(node: ProjectActionWhenNode): ConditionParts | null {
  if (node.type === 'identifier') return { identifier: node.name, negated: false }
  if (node.type === 'not' && node.node.type === 'identifier') {
    return { identifier: node.node.name, negated: true }
  }
  return null
}

export function defaultProjectActionCondition(): ProjectActionWhenNode {
  return { type: 'identifier', name: DEFAULT_WHEN_VARIABLE }
}

export function defaultProjectActionConditionGroup(
  operator: BooleanOperator = 'and',
): ProjectActionWhenNode {
  return {
    type: operator,
    left: defaultProjectActionCondition(),
    right: { type: 'not', node: defaultProjectActionCondition() },
  }
}

export function setProjectActionConditionIdentifier(
  node: ProjectActionWhenNode,
  identifier: string,
): ProjectActionWhenNode {
  const parts = projectActionConditionParts(node)
  if (parts === null) return node
  const next: ProjectActionWhenNode = { type: 'identifier', name: identifier }
  return parts.negated ? { type: 'not', node: next } : next
}

export function setProjectActionConditionNegated(
  node: ProjectActionWhenNode,
  negated: boolean,
): ProjectActionWhenNode {
  const parts = projectActionConditionParts(node)
  if (parts === null) return negated ? { type: 'not', node } : node
  const identifier: ProjectActionWhenNode = { type: 'identifier', name: parts.identifier }
  return negated ? { type: 'not', node: identifier } : identifier
}

export function projectActionConditionRemoveLabel(node: ProjectActionWhenNode, depth: number) {
  if (depth === 0) return 'Clear all conditions'
  if (projectActionConditionParts(node) !== null) return 'Remove condition'
  return 'Remove group and its conditions'
}
