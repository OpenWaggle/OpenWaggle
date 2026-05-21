import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import {
  deriveNewBranchName,
  findBranchSourceNodeId,
  findBranchStartNodeId,
  findExistingBranchForDerivedPath,
  getPathIds,
  mainBranchId,
} from './branch-utils'
import { MAIN_BRANCH_NAME } from './constants'
import type { DerivedSessionBranch, SessionBranchRow } from './types'

interface BranchForHeadInput {
  readonly sessionId: string
  readonly headId: string
  readonly index: number
  readonly mainHeadId: string | null
  readonly mainBranchRow: SessionBranchRow | undefined
  readonly existingBranches: readonly SessionBranchRow[]
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly childCounts: ReadonlyMap<string, number>
}

interface DerivedBranchHeadContext {
  readonly branchStartNodeId: string | null
  readonly existingBranch: SessionBranchRow | undefined | null
  readonly isMain: boolean
  readonly sourceNodeId: string | null
}

function branchSourceNodeId(input: BranchForHeadInput, pathIds: readonly string[]) {
  if (input.headId === input.mainHeadId) {
    return null
  }

  return findBranchSourceNodeId(pathIds, input.nodeById, input.childCounts)
}

function branchStartNodeId(input: BranchForHeadInput, pathIds: readonly string[]) {
  if (input.headId === input.mainHeadId) {
    return null
  }

  return findBranchStartNodeId(pathIds, input.nodeById, input.childCounts)
}

function existingBranchForHead(input: BranchForHeadInput, branchStartNodeId: string | null) {
  if (input.headId === input.mainHeadId) {
    return input.mainBranchRow
  }

  return findExistingBranchForDerivedPath({
    existingBranches: input.existingBranches,
    branchStartNodeId,
    headNodeId: input.headId,
    nodeById: input.nodeById,
    childCounts: input.childCounts,
  })
}

function buildBranchHeadContext(input: BranchForHeadInput): DerivedBranchHeadContext {
  const pathIds = getPathIds(input.nodeById, input.headId)
  const startNodeId = branchStartNodeId(input, pathIds)

  return {
    branchStartNodeId: startNodeId,
    existingBranch: existingBranchForHead(input, startNodeId),
    isMain: input.headId === input.mainHeadId,
    sourceNodeId: branchSourceNodeId(input, pathIds),
  }
}

function branchId(input: BranchForHeadInput, context: DerivedBranchHeadContext) {
  if (context.isMain) {
    return mainBranchId(input.sessionId)
  }

  return (
    context.existingBranch?.id ??
    `${input.sessionId}:branch:${context.branchStartNodeId ?? input.headId}`
  )
}

function branchName(input: BranchForHeadInput, context: DerivedBranchHeadContext) {
  if (context.isMain) {
    return MAIN_BRANCH_NAME
  }

  return (
    context.existingBranch?.name ??
    deriveNewBranchName({
      sourceNodeId: context.sourceNodeId,
      headNodeId: input.headId,
      nodeById: input.nodeById,
      fallback: `Branch ${input.index + 1}`,
    })
  )
}

export function deriveBranchForHead(input: BranchForHeadInput): DerivedSessionBranch {
  const context = buildBranchHeadContext(input)

  return {
    id: branchId(input, context),
    sourceNodeId: context.sourceNodeId,
    headNodeId: input.headId,
    name: branchName(input, context),
    isMain: context.isMain,
    archivedAt: context.existingBranch?.archived_at ?? null,
    createdAt: context.existingBranch?.created_at ?? Date.now(),
  }
}
