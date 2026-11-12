import type { ProjectActionWhenNode } from '@shared/utils/project-action-shortcuts'

export type BooleanOperator = 'and' | 'or'

const DEFAULT_WHEN_VARIABLE = 'terminalFocus'

export interface ConditionParts {
  readonly identifier: string
  readonly negated: boolean
}

export function booleanOperator(value: string) {
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
) {
  const first = children[0]
  if (first === undefined) return undefined
  return children
    .slice(1)
    .reduce<ProjectActionWhenNode>(
      (left, right) => ({ type: operator, left, right }),
      first,
    ) satisfies ProjectActionWhenNode | undefined
}

export function projectActionConditionParts(node: ProjectActionWhenNode) {
  if (node.type === 'identifier') {
    return { identifier: node.name, negated: false } satisfies ConditionParts
  }
  if (node.type === 'not' && node.node.type === 'identifier') {
    return { identifier: node.node.name, negated: true } satisfies ConditionParts
  }
  return null
}

export function defaultProjectActionCondition() {
  return { type: 'identifier', name: DEFAULT_WHEN_VARIABLE } satisfies ProjectActionWhenNode
}

export function defaultProjectActionConditionGroup(operator: BooleanOperator = 'and') {
  return {
    type: operator,
    left: defaultProjectActionCondition(),
    right: { type: 'not', node: defaultProjectActionCondition() },
  } satisfies ProjectActionWhenNode
}

export function setProjectActionConditionIdentifier(
  node: ProjectActionWhenNode,
  identifier: string,
) {
  const parts = projectActionConditionParts(node)
  if (parts === null) return node
  const next: ProjectActionWhenNode = { type: 'identifier', name: identifier }
  return (parts.negated ? { type: 'not', node: next } : next) satisfies ProjectActionWhenNode
}

export function setProjectActionConditionNegated(node: ProjectActionWhenNode, negated: boolean) {
  const parts = projectActionConditionParts(node)
  if (parts === null) {
    return (negated ? { type: 'not', node } : node) satisfies ProjectActionWhenNode
  }
  const identifier: ProjectActionWhenNode = { type: 'identifier', name: parts.identifier }
  return (negated ? { type: 'not', node: identifier } : identifier) satisfies ProjectActionWhenNode
}

export function projectActionConditionRemoveLabel(node: ProjectActionWhenNode, depth: number) {
  if (depth === 0) return 'Clear all conditions'
  if (projectActionConditionParts(node) !== null) return 'Remove condition'
  return 'Remove group and its conditions'
}
