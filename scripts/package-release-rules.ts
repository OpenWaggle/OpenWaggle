import { Schema } from '@shared/schema'
import { objectFields, unknownField } from './support/object-fields'
/**
 * Reads the Release Please settings that decide a package's next version, the way the pinned Release
 * Please merges them: a package's own setting wins over the top-level one. Settings the guard cannot
 * reproduce are reported instead of guessed, so a config change that would move versions differently
 * fails the check until the guard learns it.
 */

/** Release Please's base strategy falls back to 1.0.0 when `initial-version` is not set. */
const DEFAULT_INITIAL_VERSION = '1.0.0'
const SUPPORTED_RELEASE_TYPES = new Set(['node'])
const SUPPORTED_VERSIONING = new Set(['default'])
const SUPPORTED_CHANGELOG_TYPES = new Set(['default'])

export interface ChangelogSectionRule {
  readonly type: string
  readonly section: string
  readonly hidden?: boolean
}

export interface PackageReleaseRules {
  /** `bump-minor-pre-major`: before 1.0.0 a breaking change bumps the minor version. */
  readonly bumpMinorPreMajor: boolean
  /** `bump-patch-for-minor-pre-major`: before 1.0.0 a feature bumps only the patch version. */
  readonly bumpPatchForMinorPreMajor: boolean
  /** `release-as`: forces the next version. */
  readonly releaseAs: string | undefined
  /** `initial-version`: the first version of a package that was never released. */
  readonly initialVersion: string
  /** `changelog-sections`: which commit types appear in release notes, and so cause a release. */
  readonly changelogSections: readonly ChangelogSectionRule[] | undefined
}

function setting(packageConfig: object, topLevelConfig: object, key: string) {
  const own: unknown = Reflect.get(packageConfig, key)
  const result: unknown = own ?? Reflect.get(topLevelConfig, key)
  return result
}

const changelogSectionSchema = Schema.Struct({
  type: Schema.String,
  section: Schema.String,
  hidden: unknownField,
})

function changelogSections(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    const rule: readonly ChangelogSectionRule[] | undefined | string =
      'changelog-sections is not a list'
    return rule
  }
  const sections: ChangelogSectionRule[] = []
  for (const entry of value) {
    const fields = objectFields(changelogSectionSchema, entry)
    if (fields === undefined) {
      const rule: readonly ChangelogSectionRule[] | undefined | string =
        'a changelog-sections entry has no type or section'
      return rule
    }
    const { type, section, hidden } = fields
    sections.push(hidden === true ? { type, section, hidden } : { type, section })
  }
  return sections
}

function unsupportedSetting(packageConfig: object, topLevelConfig: object) {
  const releaseType = setting(packageConfig, topLevelConfig, 'release-type') ?? 'node'
  if (typeof releaseType !== 'string' || !SUPPORTED_RELEASE_TYPES.has(releaseType)) {
    return `release-type ${JSON.stringify(releaseType)} is not supported (only node)`
  }
  const versioning = setting(packageConfig, topLevelConfig, 'versioning') ?? 'default'
  if (typeof versioning !== 'string' || !SUPPORTED_VERSIONING.has(versioning)) {
    return `versioning ${JSON.stringify(versioning)} is not supported (only default)`
  }
  const changelogType = setting(packageConfig, topLevelConfig, 'changelog-type') ?? 'default'
  if (typeof changelogType !== 'string' || !SUPPORTED_CHANGELOG_TYPES.has(changelogType)) {
    return `changelog-type ${JSON.stringify(changelogType)} is not supported (only default)`
  }
  if (setting(packageConfig, topLevelConfig, 'exclude-paths') !== undefined) {
    return 'exclude-paths is not supported'
  }
  return undefined
}

/** An optional version setting: absent or empty counts as unset, as Release Please's truthiness check does. */
function optionalVersion(value: unknown) {
  if (value === undefined || value === '') {
    const result: { readonly version: string | undefined } | undefined = { version: undefined }
    return result
  }
  const result: { readonly version: string | undefined } | undefined =
    typeof value === 'string' ? { version: value } : undefined
  return result
}

/**
 * The rules Release Please applies to one package, or why the guard cannot reproduce them. The
 * message names the setting so the guard can be taught it, instead of predicting the wrong line.
 */
export function packageReleaseRules(packageConfig: object, topLevelConfig: object) {
  const unsupported = unsupportedSetting(packageConfig, topLevelConfig)
  if (unsupported !== undefined) {
    const rules: PackageReleaseRules | string = unsupported
    return rules
  }
  const releaseAs = optionalVersion(setting(packageConfig, topLevelConfig, 'release-as'))
  if (releaseAs === undefined) {
    const rules: PackageReleaseRules | string = 'release-as is not a string'
    return rules
  }
  const initialVersion = optionalVersion(setting(packageConfig, topLevelConfig, 'initial-version'))
  if (initialVersion === undefined) {
    const rules: PackageReleaseRules | string = 'initial-version is not a string'
    return rules
  }
  const sections = changelogSections(setting(packageConfig, topLevelConfig, 'changelog-sections'))
  if (typeof sections === 'string') {
    const rules: PackageReleaseRules | string = sections
    return rules
  }
  const rules: PackageReleaseRules | string = {
    bumpMinorPreMajor: setting(packageConfig, topLevelConfig, 'bump-minor-pre-major') === true,
    bumpPatchForMinorPreMajor:
      setting(packageConfig, topLevelConfig, 'bump-patch-for-minor-pre-major') === true,
    releaseAs: releaseAs.version,
    initialVersion: initialVersion.version ?? DEFAULT_INITIAL_VERSION,
    changelogSections: sections,
  }
  return rules
}
