import { Schema } from '@shared/schema'
import {
  CHANGE_REQUEST_OPEN_DESTINATIONS,
  isSourceControlHostName,
} from '@shared/types/source-control'

/** Upper bounds on the per-host and per-repository source-control maps. */
const SOURCE_CONTROL_SETTINGS_LIMITS = {
  ENTRIES: 500,
  KEY_LENGTH: 512,
} as const

const sourceControlProviderIdSchema = Schema.Literal('github', 'gitlab')
const changeRequestOpenDestinationSchema = Schema.Literal(...CHANGE_REQUEST_OPEN_DESTINATIONS)

/** A lowercase hostname, optionally with a port, as every per-host setting is keyed. */
function isSourceControlHostKey(key: string) {
  return (
    key.length > 0 &&
    key.length <= SOURCE_CONTROL_SETTINGS_LIMITS.KEY_LENGTH &&
    key === key.toLowerCase() &&
    isSourceControlHostName(key)
  )
}

function boundedRecordSchema<V extends Schema.Schema.Any>(
  value: V,
  isValidKey: (key: string) => boolean,
  label: string,
) {
  return Schema.Record({ key: Schema.String, value }).pipe(
    Schema.filter((record) => Object.keys(record).every(isValidKey), {
      message: () => `${label} has an invalid key.`,
    }),
    Schema.filter(
      (record) => Object.keys(record).length <= SOURCE_CONTROL_SETTINGS_LIMITS.ENTRIES,
      { message: () => `${label} has too many entries.` },
    ),
  )
}

function isBoundedKey(key: string) {
  return key.trim().length > 0 && key.length <= SOURCE_CONTROL_SETTINGS_LIMITS.KEY_LENGTH
}

const sourceControlHostProvidersSchema = boundedRecordSchema(
  sourceControlProviderIdSchema,
  isSourceControlHostKey,
  'Source control host providers',
)

const sourceControlProjectDeclarationSchema = Schema.Struct({
  approved: sourceControlHostProvidersSchema,
  declined: sourceControlHostProvidersSchema,
})

const repositoryValueSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(SOURCE_CONTROL_SETTINGS_LIMITS.KEY_LENGTH),
)

/** The Source control settings (ADR 0048), as `settingsWireFields` holds them. */
export const sourceControlSettingsFields = {
  /** User-wide Change request open destination; null means the user never chose one. */
  changeRequestOpenDestination: Schema.NullOr(changeRequestOpenDestinationSchema),
  /** Private per-project Change request open destination overrides, keyed by project path. */
  changeRequestOpenDestinationByProject: boundedRecordSchema(
    changeRequestOpenDestinationSchema,
    isBoundedKey,
    'Change request open destinations',
  ),
  /** The user's own provider choice per Source control host (lowercase hostname). */
  sourceControlHostProviders: boundedRecordSchema(
    Schema.Literal('github', 'gitlab', 'unsupported'),
    isSourceControlHostKey,
    'Source control host choices',
  ),
  /** Providers learned from a remote's change-request refs, cached per host. */
  sourceControlDetectedHostProviders: sourceControlHostProvidersSchema,
  /** Provider account login that can see each repository (`host/owner/repo`). */
  sourceControlRepositoryAccounts: boundedRecordSchema(
    repositoryValueSchema,
    isBoundedKey,
    'Source control repository accounts',
  ),
  /** Repository holding a fork's change requests (`host/owner/repo` → `host/owner/repo`). */
  sourceControlChangeRequestRepositories: boundedRecordSchema(
    repositoryValueSchema,
    isBoundedKey,
    'Source control change request repositories',
  ),
  /** The user's local decision on each project's shared host declarations. */
  sourceControlProjectDeclarations: boundedRecordSchema(
    sourceControlProjectDeclarationSchema,
    isBoundedKey,
    'Source control project declarations',
  ),
}
