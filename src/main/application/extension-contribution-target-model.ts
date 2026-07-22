import type { ExtensionContributionTargetView } from '@shared/types/extensions'

export interface ContributionTargetResolution {
  readonly target?: ExtensionContributionTargetView
  readonly projectPaths: readonly string[]
  readonly sessionId?: string
}

interface ResolveContributionTargetInput {
  readonly target: ExtensionContributionTargetView | undefined
  readonly eligibilityProjectPaths: readonly string[]
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
}

function uniqueTrimmedValues(values: readonly string[]) {
  const normalizedValues: string[] = []
  const seenValues = new Set<string>()

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length > 0 && !seenValues.has(trimmed)) {
      seenValues.add(trimmed)
      normalizedValues.push(trimmed)
    }
  }

  return normalizedValues
}

function normalizeTarget(
  target: ExtensionContributionTargetView | undefined,
): ExtensionContributionTargetView | undefined {
  if (target === undefined) {
    return undefined
  }

  const projectPaths =
    target.projectPaths !== undefined ? uniqueTrimmedValues(target.projectPaths) : undefined
  const sessionIds =
    target.sessionIds !== undefined ? uniqueTrimmedValues(target.sessionIds) : undefined

  if (projectPaths === undefined && sessionIds === undefined) {
    return undefined
  }

  return {
    ...(projectPaths !== undefined ? { projectPaths } : {}),
    ...(sessionIds !== undefined ? { sessionIds } : {}),
  }
}

function targetSessionId(input: {
  readonly target: ExtensionContributionTargetView | undefined
  readonly requestedSessionId: string | undefined
}) {
  const sessionIds = input.target?.sessionIds
  if (sessionIds === undefined) {
    return undefined
  }

  const requestedSessionId = input.requestedSessionId?.trim()
  return requestedSessionId !== undefined && sessionIds.includes(requestedSessionId)
    ? requestedSessionId
    : null
}

function targetProjectPaths(input: {
  readonly target: ExtensionContributionTargetView | undefined
  readonly eligibilityProjectPaths: readonly string[]
  readonly requestedProjectPaths: readonly string[]
}): readonly string[] | null {
  const targetProjectPaths = input.target?.projectPaths

  if (input.requestedProjectPaths.length === 0) {
    return targetProjectPaths === undefined ? [] : null
  }

  if (targetProjectPaths === undefined) {
    return input.eligibilityProjectPaths
  }

  const targetProjectPathSet = new Set(targetProjectPaths)
  const projectPaths = input.eligibilityProjectPaths.filter((projectPath) =>
    targetProjectPathSet.has(projectPath),
  )

  return projectPaths.length > 0 ? projectPaths : null
}

export function resolveContributionTarget(
  input: ResolveContributionTargetInput,
): ContributionTargetResolution | null {
  const target = normalizeTarget(input.target)
  const sessionId = targetSessionId({ target, requestedSessionId: input.requestedSessionId })
  if (sessionId === null) {
    return null
  }

  const projectPaths = targetProjectPaths({
    target,
    eligibilityProjectPaths: input.eligibilityProjectPaths,
    requestedProjectPaths: input.requestedProjectPaths,
  })

  return projectPaths === null
    ? null
    : {
        projectPaths,
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(target !== undefined ? { target } : {}),
      }
}
