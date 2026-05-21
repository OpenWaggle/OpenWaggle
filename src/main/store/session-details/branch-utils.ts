import { isRecord } from '@shared/utils/validation'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { BRANCH_NAME_TRUNCATE_LENGTH, MAIN_BRANCH_NAME } from './constants'
import { parseJsonValue } from './json'
import type { DerivedSessionBranch, SessionBranchRow } from './types'

export function mainBranchId(sessionId: string) {
  return `${sessionId}:${MAIN_BRANCH_NAME}`
}

export function isActiveSelectableBranch(branch: DerivedSessionBranch) {
  return branch.archivedAt === null
}

export function uniqueHeadIds(headIds: readonly (string | null)[]) {
  const result: string[] = []
  for (const headId of headIds) {
    if (!headId || result.includes(headId)) {
      continue
    }
    result.push(headId)
  }
  return result
}

export function createdOrderByNodeId(nodes: readonly ProjectedSessionNodeInput[]) {
  return new Map(nodes.map((node) => [node.id, node.createdOrder]))
}

export function buildChildCounts(nodes: readonly ProjectedSessionNodeInput[]) {
  const childCounts = new Map<string, number>()
  for (const node of nodes) {
    if (!node.parentId) {
      continue
    }
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1)
  }
  return childCounts
}

export function getPathIds(
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  headId: string | null,
) {
  if (!headId) {
    return []
  }

  const path: string[] = []
  let currentId: string | null = headId
  while (currentId) {
    const node = nodeById.get(currentId)
    if (!node) {
      break
    }
    path.unshift(node.id)
    currentId = node.parentId
  }
  return path
}

export function isDescendantOrSame(
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  candidateId: string | null,
  ancestorId: string | null,
) {
  if (!candidateId || !ancestorId) {
    return false
  }

  let currentId: string | null = candidateId
  while (currentId) {
    if (currentId === ancestorId) {
      return true
    }
    currentId = nodeById.get(currentId)?.parentId ?? null
  }
  return false
}

export function findEarliestLeafDescendant(input: {
  readonly leafIds: readonly string[]
  readonly existingHeadId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly orderById: ReadonlyMap<string, number>
}) {
  const descendants = input.leafIds.filter((leafId) =>
    isDescendantOrSame(input.nodeById, leafId, input.existingHeadId),
  )
  if (descendants.length === 0) {
    return input.existingHeadId && input.nodeById.has(input.existingHeadId)
      ? input.existingHeadId
      : null
  }

  descendants.sort(
    (left, right) => (input.orderById.get(left) ?? 0) - (input.orderById.get(right) ?? 0),
  )
  return descendants[0] ?? null
}

export function findBranchSourceNodeId(
  pathIds: readonly string[],
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  childCounts: ReadonlyMap<string, number>,
) {
  for (const nodeId of pathIds) {
    const node = nodeById.get(nodeId)
    if (!node?.parentId) {
      continue
    }
    if ((childCounts.get(node.parentId) ?? 0) > 1) {
      return node.parentId
    }
  }
  return null
}

export function findBranchStartNodeId(
  pathIds: readonly string[],
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  childCounts: ReadonlyMap<string, number>,
) {
  for (const nodeId of pathIds) {
    const node = nodeById.get(nodeId)
    if (!node?.parentId) {
      continue
    }
    if ((childCounts.get(node.parentId) ?? 0) > 1) {
      return nodeId
    }
  }
  return pathIds[pathIds.length - 1] ?? null
}

function parseMessageTextPreview(raw: string) {
  const parsed = parseJsonValue(raw)
  if (!isRecord(parsed)) {
    return null
  }

  const parts = parsed.parts
  if (!Array.isArray(parts)) {
    return null
  }

  for (const part of parts) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      const trimmed = part.text.trim()
      if (trimmed) {
        return trimmed
      }
    }
  }
  return null
}

function compactBranchName(text: string, fallback: string) {
  const words = text.replace(/\s+/g, ' ').trim()
  if (!words) {
    return fallback
  }
  return words.length > BRANCH_NAME_TRUNCATE_LENGTH
    ? `${words.slice(0, BRANCH_NAME_TRUNCATE_LENGTH)}...`
    : words
}

export function deriveNewBranchName(input: {
  readonly sourceNodeId: string | null
  readonly headNodeId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly fallback: string
}) {
  const sourceNode = input.sourceNodeId ? input.nodeById.get(input.sourceNodeId) : null
  const headNode = input.headNodeId ? input.nodeById.get(input.headNodeId) : null
  const sourcePreview = sourceNode ? parseMessageTextPreview(sourceNode.contentJson) : null
  if (sourcePreview) {
    return compactBranchName(sourcePreview, input.fallback)
  }

  const headPreview = headNode ? parseMessageTextPreview(headNode.contentJson) : null
  return headPreview ? compactBranchName(headPreview, input.fallback) : input.fallback
}

export function findExistingBranchForDerivedPath(input: {
  readonly existingBranches: readonly SessionBranchRow[]
  readonly branchStartNodeId: string | null
  readonly headNodeId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly childCounts: ReadonlyMap<string, number>
}) {
  for (const branch of input.existingBranches) {
    if (branch.is_main === 1) {
      continue
    }

    if (isDescendantOrSame(input.nodeById, input.headNodeId, branch.head_node_id)) {
      return branch
    }

    const existingPath = getPathIds(input.nodeById, branch.head_node_id)
    const existingStartNodeId = findBranchStartNodeId(
      existingPath,
      input.nodeById,
      input.childCounts,
    )
    if (existingStartNodeId && existingStartNodeId === input.branchStartNodeId) {
      return branch
    }
  }

  return null
}
