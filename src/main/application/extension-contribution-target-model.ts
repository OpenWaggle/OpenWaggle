import type { ExtensionContributionTargetView } from '@shared/types/extensions'

export interface ContributionTargetResolution {
  readonly target?: ExtensionContributionTargetView
  readonly projectPaths: readonly string[]
}

interface ResolveContributionTargetInput {
  readonly target: ExtensionContributionTargetView | undefined
  readonly eligibilityProjectPaths: readonly string[]
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
}

function uniqueTrimmedValues(values: readonly string[]) {
  const normalizedValues: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length > 0 && !normalizedValues.includes(trimmed)) {
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

function targetAllowsSession(input: {
  readonly target: ExtensionContributionTargetView | undefined
  readonly requestedSessionId: string | undefined
}) {
  const sessionIds = input.target?.sessionIds
  if (sessionIds === undefined) {
    return true
  }

  return (
    input.requestedSessionId !== undefined && sessionIds.includes(input.requestedSessionId.trim())
  )
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

  const projectPaths = input.eligibilityProjectPaths.filter((projectPath) =>
    targetProjectPaths.includes(projectPath),
  )

  return projectPaths.length > 0 ? projectPaths : null
}

export function resolveContributionTarget(
  input: ResolveContributionTargetInput,
): ContributionTargetResolution | null {
  const target = normalizeTarget(input.target)
  if (!targetAllowsSession({ target, requestedSessionId: input.requestedSessionId })) {
    return null
  }

  const projectPaths = targetProjectPaths({
    target,
    eligibilityProjectPaths: input.eligibilityProjectPaths,
    requestedProjectPaths: input.requestedProjectPaths,
  })

  return projectPaths === null
    ? null
    : { projectPaths, ...(target !== undefined ? { target } : {}) }
}
