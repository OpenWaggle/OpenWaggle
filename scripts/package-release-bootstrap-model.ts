import { Schema } from '@shared/schema'

export type JsonObject = Readonly<Record<string, unknown>>

export const BOOTSTRAP_VERSION = '0.0.0-bootstrap.0'
export const BOOTSTRAP_TAG = 'bootstrap'
export const DEPRECATION_MESSAGE = 'Namespace bootstrap placeholder; use a released version.'
export const NPM_ENVIRONMENT = 'npm'
export const PACKAGE_RELEASE_WORKFLOW = 'package-release.yml'
export const REPOSITORY = 'OpenWaggle/OpenWaggle'
export const MANAGED_RULESET_NAME = 'OpenWaggle main protections'
export const ADMIN_REPOSITORY_ROLE_ID = 5
const BOOTSTRAP_FORBIDDEN_FIELDS = [
  'main',
  'exports',
  'imports',
  'module',
  'browser',
  'types',
  'typings',
  'bin',
  'man',
  'scripts',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundledDependencies',
  'bundleDependencies',
] as const
const BOOTSTRAP_WITH_LATEST_TAG_COUNT = 2

export const PACKAGE_NAMES = [
  '@openwaggle/extension-sdk',
  '@openwaggle/extension-react',
  '@openwaggle/waggle-core',
  '@openwaggle/pi-waggle',
] as const

export const REQUIRED_CHECK_CONTEXTS = [
  'Package Release Gate',
  'Commit Policy',
  'Typecheck & Lint',
  'Unit Tests',
  'Integration & Component Tests',
  'MCP Conformance',
] as const

export const DEPLOYED_LEGACY_CHECK_CONTEXTS = [
  'Commit Policy',
  'Typecheck & Lint',
  'Unit & Component Tests',
] as const

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

export function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(error)}`, { cause: error })
  }
}

export function parseJsonObject(value: string, label: string) {
  const parsed = parseJson(value, label)
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} must return a JSON object.`)
  }
  return parsed
}

export function createPlaceholderManifest(packageName: string) {
  return {
    description: 'Namespace-only bootstrap placeholder. This package contains no runtime code.',
    files: [],
    license: 'UNLICENSED',
    name: packageName,
    openwaggleNamespaceBootstrap: true,
    publishConfig: { access: 'public', tag: BOOTSTRAP_TAG },
    version: BOOTSTRAP_VERSION,
  }
}

export function createEnvironmentPayload() {
  return {
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
    prevent_self_review: false,
    reviewers: [],
    wait_timer: 0,
  }
}

export function createRepositoryMergePolicyPayload() {
  return {
    allow_merge_commit: false,
    allow_rebase_merge: true,
    allow_squash_merge: true,
  }
}

export function createRulesetPayload() {
  return {
    bypass_actors: [
      {
        actor_id: ADMIN_REPOSITORY_ROLE_ID,
        actor_type: 'RepositoryRole',
        bypass_mode: 'always',
      },
    ],
    conditions: {
      ref_name: { exclude: [], include: ['refs/heads/main'] },
    },
    enforcement: 'active',
    name: MANAGED_RULESET_NAME,
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        parameters: {
          allowed_merge_methods: ['squash', 'rebase'],
          dismiss_stale_reviews_on_push: false,
          require_extra_approval_for_unattributed_changes: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
        type: 'pull_request',
      },
      {
        parameters: {
          do_not_enforce_on_create: true,
          required_status_checks: REQUIRED_CHECK_CONTEXTS.map((context) => ({ context })),
          strict_required_status_checks_policy: true,
        },
        type: 'required_status_checks',
      },
    ],
    target: 'branch',
  }
}

/** A ruleset rule this module reads: its `type` and, when it has them, its `parameters`. */
const rulesetRuleSchema = Schema.Struct({
  type: Schema.String,
  parameters: Schema.optionalWith(Schema.Unknown, { exact: true }),
})
const rulesetRulesSchema = Schema.Struct({
  rules: Schema.optionalWith(Schema.Unknown, { exact: true }),
})
const isRulesetRule = Schema.is(rulesetRuleSchema)

function rulesetRuleParameters(rules: unknown, type: string) {
  if (!isUnknownArray(rules)) return undefined
  const parameters = rules.filter(isRulesetRule).find((rule) => rule.type === type)?.parameters
  return isJsonObject(parameters) ? parameters : undefined
}

export function createRulesetUpgradePayload(value: unknown) {
  if (!isJsonObject(value) || !Schema.is(rulesetRulesSchema)(value)) {
    throw new Error('GitHub managed ruleset must be an object before it can be upgraded.')
  }
  const pullRequestParameters = rulesetRuleParameters(value.rules, 'pull_request')
  const statusParameters = rulesetRuleParameters(value.rules, 'required_status_checks')
  if (pullRequestParameters === undefined || statusParameters === undefined) {
    throw new Error('GitHub managed ruleset is missing required rule parameters.')
  }

  return {
    ...createRulesetPayload(),
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        parameters: { ...pullRequestParameters },
        type: 'pull_request',
      },
      {
        parameters: {
          ...statusParameters,
          required_status_checks: REQUIRED_CHECK_CONTEXTS.map((context) => ({ context })),
        },
        type: 'required_status_checks',
      },
    ],
  }
}

const trustConfigurationSchema = Schema.Struct({
  type: Schema.Literal('github'),
  repository: Schema.Literal(REPOSITORY),
  file: Schema.Literal(PACKAGE_RELEASE_WORKFLOW),
  environment: Schema.Literal(NPM_ENVIRONMENT),
  permissions: Schema.Tuple(Schema.Literal('createPackage')),
})

export const isCompatibleTrustConfiguration = Schema.is(trustConfigurationSchema)

/** The npm bootstrap record fields the compatibility check reads. */
const bootstrapRecordSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.Literal(BOOTSTRAP_VERSION),
  openwaggleNamespaceBootstrap: Schema.Literal(true),
  dist: Schema.optionalWith(Schema.Unknown, { exact: true }),
  files: Schema.optionalWith(Schema.Unknown, { exact: true }),
  directories: Schema.optionalWith(Schema.Unknown, { exact: true }),
  deprecated: Schema.optionalWith(Schema.Unknown, { exact: true }),
})
const distMetadataSchema = Schema.Struct({
  fileCount: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

function distFileCountOf(dist: unknown) {
  return isJsonObject(dist) && Schema.is(distMetadataSchema)(dist) ? dist.fileCount : undefined
}

export function isCompatibleBootstrapRecord(value: unknown, packageName: string) {
  if (!isJsonObject(value)) return false
  const manifest = value
  if (!Schema.is(bootstrapRecordSchema)(value) || value.name !== packageName) return false

  const hasDistMetadata = value.dist !== undefined
  const distFileCount = distFileCountOf(value.dist)
  const hasCompatibleDistMetadata = !hasDistMetadata || distFileCount === 1
  const manifestHasNoFiles =
    isUnknownArray(value.files) && value.files.length === 0 && hasCompatibleDistMetadata
  const registryMetadataHasOnlyManifest = value.files === undefined && distFileCount === 1
  const hasCompatibleDirectories =
    value.directories === undefined ||
    (isJsonObject(value.directories) && Object.keys(value.directories).length === 0)

  return (
    (manifestHasNoFiles || registryMetadataHasOnlyManifest) &&
    hasCompatibleDirectories &&
    BOOTSTRAP_FORBIDDEN_FIELDS.every((field) => manifest[field] === undefined)
  )
}

const deprecationSchema = Schema.Struct({
  deprecated: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export function isCompatibleBootstrapMetadata(value: unknown, packageName: string) {
  return (
    isCompatibleBootstrapRecord(value, packageName) &&
    Schema.is(deprecationSchema)(value) &&
    value.deprecated === DEPRECATION_MESSAGE
  )
}

export function needsBootstrapDeprecation(value: unknown) {
  return (
    isJsonObject(value) && Schema.is(deprecationSchema)(value) && value.deprecated === undefined
  )
}

/** The npm dist-tags the bootstrap owns: `bootstrap`, and `latest` when npm added it. */
const bootstrapTagsSchema = Schema.Struct({
  bootstrap: Schema.Literal(BOOTSTRAP_VERSION),
  latest: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export function hasCompatibleTags(value: unknown) {
  if (!isJsonObject(value) || !Schema.is(bootstrapTagsSchema)(value)) return false
  const tagCount = Object.keys(value).length
  return (
    tagCount === 1 ||
    (tagCount === BOOTSTRAP_WITH_LATEST_TAG_COUNT && value.latest === BOOTSTRAP_VERSION)
  )
}

export function isPublicAccess(value: string, packageName: string) {
  const parsed = parseJson(value.trim(), 'npm access get status')
  return (
    isJsonObject(parsed) && Object.keys(parsed).length === 1 && parsed[packageName] === 'public'
  )
}
