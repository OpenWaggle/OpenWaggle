import { matchBy } from '@diegogbrisa/ts-match'
import type {
  BrowserImportInput,
  BrowserImportResult,
  GuidedBrowserImportInput,
  GuidedBrowserImportResult,
} from '@shared/types/browser-import'
import type { BrowserProfile } from '@shared/types/browser-profile'
import {
  BROWSER_PROFILE_LIMITS,
  isBuiltInBrowserProfileId,
  resolveBrowserProfiles,
} from '@shared/types/browser-profile'
import { BrowserImportError, browserImportFailure } from './browser-import-errors'
import { browserImportSourceDefinition } from './browser-import-source-definitions'

const PROFILE_NAME_SUFFIX_START = 2

interface GuidedBrowserImportOptions {
  readonly getConfiguredProfiles: () =>
    | readonly BrowserProfile[]
    | Promise<readonly BrowserProfile[]>
  readonly updateConfiguredProfiles: (profiles: readonly BrowserProfile[]) => void | Promise<void>
  readonly importCookiesIntoPreparedProfile: (
    input: BrowserImportInput,
    target: BrowserProfile,
  ) => Promise<BrowserImportResult>
  readonly clearProfileData: (profileId: string) => Promise<void>
}

type PreparedGuidedTarget =
  | { readonly kind: 'new'; readonly profile: BrowserProfile }
  | { readonly kind: 'existing'; readonly profile: BrowserProfile }

function profileLimitError() {
  return new BrowserImportError('profile-limit-reached', 'The browser profile limit was reached.')
}

function unavailableTargetError() {
  return new BrowserImportError(
    'unknown-target-profile',
    'The selected destination profile no longer exists.',
  )
}

function nextProfileName(baseName: string, profiles: readonly BrowserProfile[]) {
  const taken = new Set(resolveBrowserProfiles(profiles).map((profile) => profile.name))
  const boundedBase = baseName.slice(0, BROWSER_PROFILE_LIMITS.NAME_LENGTH)
  if (!taken.has(boundedBase)) return boundedBase

  for (
    let index = PROFILE_NAME_SUFFIX_START;
    index <= BROWSER_PROFILE_LIMITS.USER_PROFILES + PROFILE_NAME_SUFFIX_START;
    index += 1
  ) {
    const suffix = ` ${String(index)}`
    const candidate = `${boundedBase.slice(
      0,
      BROWSER_PROFILE_LIMITS.NAME_LENGTH - suffix.length,
    )}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return boundedBase
}

async function prepareTarget(
  input: GuidedBrowserImportInput,
  options: GuidedBrowserImportOptions,
  sourceName: string,
): Promise<PreparedGuidedTarget> {
  const configured = await options.getConfiguredProfiles()
  const resolved = resolveBrowserProfiles(configured)

  return matchBy(input.target, 'kind')
    .with('existing', (target) => {
      const profile = resolved.find((candidate) => candidate.id === target.profileId)
      if (profile?.kind !== 'persistent') throw unavailableTargetError()
      return { kind: 'existing', profile } as const
    })
    .with('new', (target) => {
      if (isBuiltInBrowserProfileId(target.profileId)) throw unavailableTargetError()
      const existing = resolved.find((candidate) => candidate.id === target.profileId)
      if (existing?.kind === 'persistent') return { kind: 'existing', profile: existing } as const
      if (configured.length >= BROWSER_PROFILE_LIMITS.USER_PROFILES) throw profileLimitError()
      return {
        kind: 'new',
        profile: { id: target.profileId, name: sourceName, kind: 'persistent' },
      } as const
    })
    .exhaustive()
}

async function clearFailedTarget(
  profileId: string,
  options: GuidedBrowserImportOptions,
  failure: BrowserImportError,
): Promise<never> {
  try {
    await options.clearProfileData(profileId)
  } catch (cause) {
    throw new BrowserImportError(
      'profile-cleanup-failed',
      'The failed browser profile could not be cleared.',
      cause,
    )
  }
  throw failure
}

export function createGuidedBrowserImporter(options: GuidedBrowserImportOptions) {
  let finalizationQueue: Promise<void> = Promise.resolve()

  function serializeFinalization<T>(operation: () => Promise<T>) {
    const result = finalizationQueue.catch(() => undefined).then(operation)
    finalizationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function finishExistingImport(
    prepared: Extract<PreparedGuidedTarget, { readonly kind: 'existing' }>,
    result: BrowserImportResult,
  ): Promise<GuidedBrowserImportResult> {
    return serializeFinalization(async () => {
      const current = resolveBrowserProfiles(await options.getConfiguredProfiles()).find(
        (profile) => profile.id === prepared.profile.id,
      )
      if (current?.kind !== 'persistent') {
        return clearFailedTarget(prepared.profile.id, options, unavailableTargetError())
      }
      return {
        ok: true,
        result,
        targetName: current.name,
        createdProfile: null,
      }
    })
  }

  async function finishNewImport(
    prepared: Extract<PreparedGuidedTarget, { readonly kind: 'new' }>,
    result: BrowserImportResult,
  ): Promise<GuidedBrowserImportResult> {
    if (result.imported === 0) {
      return {
        ok: true,
        result,
        targetName: prepared.profile.name,
        createdProfile: null,
      }
    }

    return serializeFinalization(async () => {
      const configured = await options.getConfiguredProfiles()
      const existing = resolveBrowserProfiles(configured).find(
        (profile) => profile.id === prepared.profile.id,
      )
      if (existing?.kind === 'persistent') {
        return {
          ok: true,
          result,
          targetName: existing.name,
          createdProfile: null,
        }
      }
      if (configured.length >= BROWSER_PROFILE_LIMITS.USER_PROFILES) {
        return clearFailedTarget(prepared.profile.id, options, profileLimitError())
      }

      const createdProfile: BrowserProfile = {
        ...prepared.profile,
        name: nextProfileName(prepared.profile.name, configured),
      }
      try {
        await options.updateConfiguredProfiles([...configured, createdProfile])
      } catch (cause) {
        return clearFailedTarget(
          prepared.profile.id,
          options,
          new BrowserImportError(
            'profile-not-saved',
            'The new browser profile could not be saved.',
            cause,
          ),
        )
      }
      return {
        ok: true,
        result,
        targetName: createdProfile.name,
        createdProfile,
      }
    })
  }

  return {
    importCookies: async (input: GuidedBrowserImportInput): Promise<GuidedBrowserImportResult> => {
      try {
        const definition = browserImportSourceDefinition(input.sourceId)
        if (!definition) {
          throw new BrowserImportError(
            'unknown-source',
            'The selected browser source is unavailable.',
          )
        }
        const prepared = await prepareTarget(input, options, definition.name)
        const result = await options.importCookiesIntoPreparedProfile(
          {
            sourceId: input.sourceId,
            sourceProfileDirectory: input.sourceProfileDirectory,
            targetProfileId: prepared.profile.id,
          },
          prepared.profile,
        )
        return await matchBy(prepared, 'kind')
          .with('existing', (target) => finishExistingImport(target, result))
          .with('new', (target) => finishNewImport(target, result))
          .exhaustive()
      } catch (cause) {
        return { ok: false, ...browserImportFailure(cause) }
      }
    },
  }
}
