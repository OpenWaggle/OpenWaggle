import path from 'node:path'
import type { AgentSessionServices } from '@mariozechner/pi-coding-agent'
import { isPathInside } from '../../utils/paths'
import type { PiExtensionLoadErrorRecord } from './pi-provider-catalog-types'

export function getPiRuntimeExtensionLoadErrors(
  services: Pick<AgentSessionServices, 'resourceLoader'>,
): readonly PiExtensionLoadErrorRecord[] {
  return services.resourceLoader
    .getExtensions()
    .errors.map((error) => ({ path: error.path, error: error.error }))
}

function loadErrorMatchesPackagePath(input: {
  readonly errorPath: string
  readonly packagePath: string
}) {
  return isPathInside(path.resolve(input.packagePath), path.resolve(input.errorPath))
}

function matchingOpenWaggleExtensionLoadErrors(input: {
  readonly errors: readonly PiExtensionLoadErrorRecord[]
  readonly enabledOpenWaggleExtensionPackagePaths: readonly string[]
}) {
  return input.errors.filter((error) =>
    input.enabledOpenWaggleExtensionPackagePaths.some((packagePath) =>
      loadErrorMatchesPackagePath({ errorPath: error.path, packagePath }),
    ),
  )
}

export function rejectMatchingOpenWaggleExtensionLoadErrors<Result>(input: {
  readonly result: Result
  readonly errors: readonly PiExtensionLoadErrorRecord[]
  readonly enabledOpenWaggleExtensionPackagePaths: readonly string[]
}): Result {
  const matchingErrors = matchingOpenWaggleExtensionLoadErrors(input)

  if (matchingErrors.length === 0) {
    return input.result
  }

  throw new Error(
    `Pi reported OpenWaggle extension load errors: ${matchingErrors
      .map((error) => `${error.path}: ${error.error}`)
      .join('; ')}`,
  )
}
