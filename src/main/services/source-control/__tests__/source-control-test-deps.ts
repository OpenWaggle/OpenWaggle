import {
  resolveSourceControlRemote,
  type SourceControlRemoteResolutionDeps,
} from '../source-control-remote-resolution'
import { resolveRemoteUrlRepository } from '../working-tree-source-control'

/** Resolution with no user choices, CLI sign-ins, or git hints: hostname rules only. */
export function offlineResolutionDeps(
  overrides: Partial<SourceControlRemoteResolutionDeps> = {},
): SourceControlRemoteResolutionDeps {
  return {
    readPrimaryRemote: async () => ({ name: 'origin', url: 'git@github.com:acme/app.git' }),
    readPreferences: async () => ({ userChoices: {}, detectedHosts: {}, projectDeclarations: {} }),
    readProjectDeclarations: async () => ({}),
    readCliHosts: async () => ({ github: [], gitlab: [] }),
    readCredentialHelpers: async () => ({}),
    resolveSshHostName: async (alias) => alias,
    probeRemoteRefs: async () => null,
    rememberDetectedHost: async () => undefined,
    ...overrides,
  }
}

/** A `resolveRemoteRepository` dependency for tests that exercises the real resolver offline. */
export function resolveRemoteRepositoryOffline(projectPath: string, remoteUrl: string) {
  return resolveRemoteUrlRepository(projectPath, remoteUrl, offlineResolutionDeps(), null)
}

export const WORKING_PATH = '/work/acme-app'
export const PROJECT_PATH = '/work/acme-app'

/** Resolve the test working tree with {@link offlineResolutionDeps} plus overrides. */
export function resolveOffline(
  overrides: Partial<SourceControlRemoteResolutionDeps> = {},
  probeRemote = false,
) {
  return resolveSourceControlRemote(
    { workingPath: WORKING_PATH, projectPath: PROJECT_PATH, probeRemote },
    offlineResolutionDeps(overrides),
  )
}
