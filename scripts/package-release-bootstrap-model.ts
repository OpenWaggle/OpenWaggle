export type JsonObject = {
  readonly [key: string]: unknown
}

export const BOOTSTRAP_VERSION = '0.0.0-bootstrap.0'
export const BOOTSTRAP_TAG = 'bootstrap'
export const DEPRECATION_MESSAGE =
  'Namespace bootstrap placeholder; use a released version.'
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
  'directories',
  'scripts',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundledDependencies',
  'bundleDependencies',
] as const

export const PACKAGE_NAMES = [
  '@openwaggle/extension-sdk',
  '@openwaggle/extension-react',
  '@openwaggle/waggle-core',
  '@openwaggle/pi-waggle',
] as const

export const REQUIRED_CHECK_CONTEXTS = [
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

function stringArray(value: unknown) {
  return isUnknownArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

export function isCompatibleTrustConfiguration(value: unknown) {
  if (!isJsonObject(value)) return false
  const permissions = stringArray(value.permissions)
  return (
    value.type === 'github' &&
    value.repository === REPOSITORY &&
    value.file === PACKAGE_RELEASE_WORKFLOW &&
    value.environment === NPM_ENVIRONMENT &&
    permissions?.length === 1 &&
    permissions[0] === 'createPackage'
  )
}

export function isCompatibleBootstrapRecord(value: unknown, packageName: string) {
  if (!isJsonObject(value)) return false
  if (
    value.name !== packageName ||
    value.version !== BOOTSTRAP_VERSION ||
    value.openwaggleNamespaceBootstrap !== true
  ) {
    return false
  }

  return (
    isUnknownArray(value.files) &&
    value.files.length === 0 &&
    BOOTSTRAP_FORBIDDEN_FIELDS.every((field) => value[field] === undefined)
  )
}

export function isCompatibleBootstrapMetadata(value: unknown, packageName: string) {
  return (
    isCompatibleBootstrapRecord(value, packageName) &&
    isJsonObject(value) &&
    value.deprecated === DEPRECATION_MESSAGE
  )
}

export function needsBootstrapDeprecation(value: unknown) {
  return isJsonObject(value) && value.deprecated === undefined
}

export function hasCompatibleTags(value: unknown) {
  if (!isJsonObject(value) || value.bootstrap !== BOOTSTRAP_VERSION) return false
  return Object.entries(value).every(
    ([tag, version]) => tag === BOOTSTRAP_TAG || version !== BOOTSTRAP_VERSION,
  )
}

export function isPublicAccess(value: string, packageName: string) {
  const parsed = parseJson(value.trim(), 'npm access get status')
  return (
    isJsonObject(parsed) &&
    Object.keys(parsed).length === 1 &&
    parsed[packageName] === 'public'
  )
}
