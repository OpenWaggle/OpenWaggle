import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  BROWSER_IMPORT_LIMITS,
  type BrowserImportSourceProfile,
} from '@shared/types/browser-import'

const SAFARI_DEFAULT_PROFILE_ID = 'DefaultProfile'
const SAFARI_PROFILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

interface SafariProfileRow {
  readonly title: string | null
  readonly external_uuid: string
}

function asSafariProfileRow(value: unknown): SafariProfileRow | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('external_uuid' in value) ||
    !('title' in value)
  ) {
    return undefined
  }
  const externalUuid = value.external_uuid
  const title = value.title
  if (typeof externalUuid !== 'string' || (title !== null && typeof title !== 'string')) {
    return undefined
  }
  return { external_uuid: externalUuid, title }
}

function declaredSafariProfiles(metadataPath: string) {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(metadataPath, { readOnly: true })
    const rows = database
      .prepare(
        `SELECT title, external_uuid FROM bookmarks
         WHERE parent = 0 AND type = 1 AND subtype = 2 AND deleted = 0
         ORDER BY order_index
         LIMIT ?`,
      )
      .all(BROWSER_IMPORT_LIMITS.SOURCE_PROFILES)
    return rows.map(asSafariProfileRow).filter((profile) => profile !== undefined)
  } catch {
    return []
  } finally {
    database?.close()
  }
}

async function scannedSafariProfiles(storesRoot: string) {
  try {
    const entries = await readdir(storesRoot, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && SAFARI_PROFILE_UUID.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, BROWSER_IMPORT_LIMITS.SOURCE_PROFILES)
      .map((entry) => ({
        directory: path.join(storesRoot, entry.name, 'Cookies'),
        name: entry.name,
      }))
  } catch {
    return []
  }
}

export async function listSafariProfiles(
  cookieRoot: string,
): Promise<readonly BrowserImportSourceProfile[]> {
  const libraryRoot = path.dirname(cookieRoot)
  const declared = declaredSafariProfiles(path.join(libraryRoot, 'Safari', 'SafariTabs.db'))
  const defaultProfile = declared.find(
    (profile) => profile.external_uuid === SAFARI_DEFAULT_PROFILE_ID,
  )
  const profiles: BrowserImportSourceProfile[] = [
    {
      directory: '.',
      name: defaultProfile?.title?.trim() || (defaultProfile ? 'Personal' : 'Safari'),
    },
  ]
  const storesRoot = path.join(libraryRoot, 'WebKit', 'WebsiteDataStore')
  if (declared.length === 0) {
    profiles.push(...(await scannedSafariProfiles(storesRoot)))
    return profiles
  }
  for (const profile of declared) {
    if (!SAFARI_PROFILE_UUID.test(profile.external_uuid)) continue
    profiles.push({
      directory: path.join(storesRoot, profile.external_uuid.toLowerCase(), 'Cookies'),
      name: profile.title?.trim() || profile.external_uuid,
    })
  }
  return profiles.slice(0, BROWSER_IMPORT_LIMITS.SOURCE_PROFILES)
}
