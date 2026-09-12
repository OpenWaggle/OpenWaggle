import path from 'node:path'
import type {
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
} from '@shared/types/browser-import'
import type { BrowserProfile } from '@shared/types/browser-profile'
import type { Session } from 'electron'
import { browserPreviewSessionForProfile } from '../browser-preview-profile-session'
import { type BrowserCookieReadResult, boundedSkippedDomains } from './browser-cookie-model'
import { BrowserImportError, browserImportError } from './browser-import-errors'
import {
  type BrowserImportPathContext,
  browserImportSourceDefinition,
  resolveCookieDatabase,
} from './browser-import-source-definitions'
import { defaultBrowserImportPathContext, listBrowserImportSources } from './browser-import-sources'
import { type ChromiumCookieSource, readChromiumCookies } from './chromium-cookie-reader'
import { readFirefoxCookies } from './firefox-cookie-reader'
import { readSafariCookies } from './safari-cookie-reader'

const MILLISECONDS_PER_SECOND = 1_000

interface ImportSession {
  readonly cookies: Pick<Session['cookies'], 'set' | 'flushStore'>
}

export interface BrowserCookieImporterOptions {
  readonly getTargetProfiles: () => readonly BrowserProfile[] | Promise<readonly BrowserProfile[]>
  readonly getSession?: (profileId: string) => ImportSession | Promise<ImportSession>
  readonly pathContext?: BrowserImportPathContext
  readonly listSources?: (
    context: BrowserImportPathContext,
  ) => Promise<readonly BrowserImportSource[]>
  readonly readChromium?: (source: ChromiumCookieSource) => Promise<BrowserCookieReadResult>
  readonly readFirefox?: (databasePath: string) => Promise<BrowserCookieReadResult>
  readonly readSafari?: (databasePath: string) => Promise<BrowserCookieReadResult>
}

function cookieHost(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export async function writeImportedCookies(
  session: ImportSession,
  read: BrowserCookieReadResult,
  nowSeconds = Date.now() / MILLISECONDS_PER_SECOND,
): Promise<BrowserImportResult> {
  let imported = 0
  let skipped = read.skipped
  const skippedDomains = new Set(read.skippedDomains)
  for (const cookie of read.cookies) {
    if (cookie.expirationDate !== undefined && cookie.expirationDate <= nowSeconds) {
      skipped += 1
      skippedDomains.add(cookieHost(cookie.url))
      continue
    }
    try {
      await session.cookies.set(cookie)
      imported += 1
    } catch {
      skipped += 1
      skippedDomains.add(cookieHost(cookie.url))
    }
  }
  if (imported > 0) {
    try {
      await session.cookies.flushStore()
    } catch {
      // The cookies remain live in the session; Chromium retries persistence.
    }
  }
  return {
    imported,
    skipped,
    skippedDomains: boundedSkippedDomains(skippedDomains),
  }
}

function readSourceCookies(
  sourceId: BrowserImportInput['sourceId'],
  databasePath: string,
  context: BrowserImportPathContext,
  options: BrowserCookieImporterOptions,
) {
  const definition = browserImportSourceDefinition(sourceId)
  if (!definition) {
    throw new BrowserImportError('unknown-source', 'The selected browser source is unavailable.')
  }
  if (definition.engine === 'firefox') {
    return (options.readFirefox ?? readFirefoxCookies)(databasePath)
  }
  if (definition.engine === 'safari') {
    return (options.readSafari ?? readSafariCookies)(databasePath)
  }
  const root = definition.userDataDirectory(context)
  return (options.readChromium ?? readChromiumCookies)({
    cookieDatabasePath: databasePath,
    platform: context.platform,
    ...(definition.keychainService ? { keychainService: definition.keychainService } : {}),
    ...(definition.keychainAccount ? { keychainAccount: definition.keychainAccount } : {}),
    ...(definition.linuxSecretApplication
      ? { linuxSecretApplication: definition.linuxSecretApplication }
      : {}),
    ...(context.platform === 'win32' && root
      ? { windowsLocalStatePath: path.join(root, 'Local State') }
      : {}),
  })
}

async function importFromSource(
  input: BrowserImportInput,
  options: BrowserCookieImporterOptions,
  context: BrowserImportPathContext,
  preparedTarget?: BrowserProfile,
) {
  const target =
    preparedTarget ??
    (await options.getTargetProfiles()).find((profile) => profile.id === input.targetProfileId)
  if (
    target?.kind !== 'persistent' ||
    (preparedTarget !== undefined && preparedTarget.id !== input.targetProfileId)
  ) {
    throw new BrowserImportError(
      'unknown-target-profile',
      'Cookies can only be imported into an existing persistent browser profile.',
    )
  }
  const definition = browserImportSourceDefinition(input.sourceId)
  if (!definition) {
    throw new BrowserImportError('unknown-source', 'The selected browser source is unavailable.')
  }
  if (!definition.platforms.includes(context.platform)) {
    throw new BrowserImportError(
      'unsupported-platform',
      'The selected browser cannot be imported on this operating system.',
    )
  }
  const sources = await (options.listSources ?? listBrowserImportSources)(context)
  const source = sources.find((candidate) => candidate.id === input.sourceId)
  if (!source) {
    throw new BrowserImportError('unknown-source', 'The selected browser source is unavailable.')
  }
  if (source.unavailable) {
    throw new BrowserImportError(source.unavailable, 'The selected browser cannot be imported.')
  }
  const sourceProfile = source.profiles.find(
    (profile) => profile.directory === input.sourceProfileDirectory,
  )
  if (!sourceProfile) {
    throw new BrowserImportError(
      'unknown-source-profile',
      'The selected source profile no longer exists.',
    )
  }
  const databasePath = await resolveCookieDatabase(definition, context, sourceProfile.directory)
  if (!databasePath) {
    throw new BrowserImportError('read-failed', 'The browser cookie store no longer exists.')
  }
  const read = await readSourceCookies(input.sourceId, databasePath, context, options)
  let session: ImportSession
  try {
    session = await (options.getSession ?? browserPreviewSessionForProfile)(target.id)
  } catch (cause) {
    throw new BrowserImportError(
      'session-unavailable',
      'The target browser profile could not be opened.',
      cause,
    )
  }
  return writeImportedCookies(session, read)
}

export function createBrowserCookieImporter(options: BrowserCookieImporterOptions) {
  const context = options.pathContext ?? defaultBrowserImportPathContext()
  const queues = new Map<string, Promise<void>>()

  function enqueueImport(input: BrowserImportInput, preparedTarget?: BrowserProfile) {
    const previous = queues.get(input.targetProfileId) ?? Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(() => importFromSource(input, options, context, preparedTarget))
      .catch((cause: unknown) => {
        throw browserImportError(cause, 'read-failed', 'Browser cookie import failed.')
      })
    const tail = operation.then(
      () => undefined,
      () => undefined,
    )
    queues.set(input.targetProfileId, tail)
    return operation.finally(() => {
      if (queues.get(input.targetProfileId) === tail) queues.delete(input.targetProfileId)
    })
  }

  return {
    listSources: () => (options.listSources ?? listBrowserImportSources)(context),
    importCookies: (input: BrowserImportInput) => enqueueImport(input),
    /** The caller owns membership checks and registration for this destination. */
    importCookiesIntoPreparedProfile: (input: BrowserImportInput, target: BrowserProfile) =>
      enqueueImport(input, target),
  }
}
