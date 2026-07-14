import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { BASE_TEN } from '@shared/constants/math'
import type { ExtensionSdkCompatibility } from './types'

interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

interface VersionRange {
  readonly min?: SemanticVersion
  readonly minInclusive?: boolean
  readonly max?: SemanticVersion
  readonly maxInclusive?: boolean
}

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = OPENWAGGLE_EXTENSION.PATTERNS.SEMVER_CORE.exec(value.trim())
  const major = match?.[OPENWAGGLE_EXTENSION.SEMVER_MATCH.MAJOR]
  const minor = match?.[OPENWAGGLE_EXTENSION.SEMVER_MATCH.MINOR]
  const patch = match?.[OPENWAGGLE_EXTENSION.SEMVER_MATCH.PATCH]
  if (!major || !minor || !patch) {
    return null
  }

  return {
    major: Number.parseInt(major, BASE_TEN),
    minor: Number.parseInt(minor, BASE_TEN),
    patch: Number.parseInt(patch, BASE_TEN),
  }
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion) {
  if (left.major !== right.major) {
    return left.major - right.major
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }
  return left.patch - right.patch
}

function incrementMajor(version: SemanticVersion): SemanticVersion {
  return {
    major: version.major + 1,
    minor: 0,
    patch: 0,
  }
}

function incrementMinor(version: SemanticVersion): SemanticVersion {
  return {
    major: version.major,
    minor: version.minor + 1,
    patch: 0,
  }
}

function incrementPatch(version: SemanticVersion): SemanticVersion {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
  }
}

function caretUpperBound(version: SemanticVersion): SemanticVersion {
  if (version.major > 0) {
    return incrementMajor(version)
  }
  if (version.minor > 0) {
    return incrementMinor(version)
  }
  return incrementPatch(version)
}

function versionSatisfiesRange(version: SemanticVersion, range: VersionRange) {
  if (range.min) {
    const comparedToMin = compareSemanticVersions(version, range.min)
    if (comparedToMin < 0 || (comparedToMin === 0 && range.minInclusive === false)) {
      return false
    }
  }
  if (range.max) {
    const comparedToMax = compareSemanticVersions(version, range.max)
    if (comparedToMax > 0 || (comparedToMax === 0 && range.maxInclusive === false)) {
      return false
    }
  }
  return true
}

function parseExactRange(value: string): VersionRange | null {
  const version = parseSemanticVersion(value)
  return version ? { min: version, minInclusive: true, max: version, maxInclusive: true } : null
}

function parseCaretRange(value: string): VersionRange | null {
  if (!value.startsWith('^')) {
    return null
  }
  const version = parseSemanticVersion(value.slice(1))
  return version
    ? { min: version, minInclusive: true, max: caretUpperBound(version), maxInclusive: false }
    : null
}

function parseTildeRange(value: string): VersionRange | null {
  if (!value.startsWith('~')) {
    return null
  }
  const version = parseSemanticVersion(value.slice(1))
  return version
    ? { min: version, minInclusive: true, max: incrementMinor(version), maxInclusive: false }
    : null
}

function mergeComparator(range: VersionRange, operator: string, version: SemanticVersion) {
  if (operator === '>' || operator === '>=') {
    if (range.min) {
      const comparedToCurrentMin = compareSemanticVersions(version, range.min)
      if (comparedToCurrentMin < 0) {
        return range
      }
      if (comparedToCurrentMin === 0) {
        return {
          ...range,
          minInclusive: (range.minInclusive ?? true) && operator === '>=',
        }
      }
    }
    return {
      ...range,
      min: version,
      minInclusive: operator === '>=',
    }
  }
  if (operator === '<' || operator === '<=') {
    if (range.max) {
      const comparedToCurrentMax = compareSemanticVersions(version, range.max)
      if (comparedToCurrentMax > 0) {
        return range
      }
      if (comparedToCurrentMax === 0) {
        return {
          ...range,
          maxInclusive: (range.maxInclusive ?? true) && operator === '<=',
        }
      }
    }
    return {
      ...range,
      max: version,
      maxInclusive: operator === '<=',
    }
  }
  return mergeComparator(mergeComparator(range, '>=', version), '<=', version)
}

function parseComparatorRange(value: string): VersionRange | null {
  const parts = value.split(/\s+/).filter((part) => part.length > 0)
  if (parts.length === 0) {
    return null
  }

  let range: VersionRange = {}
  for (const part of parts) {
    const match = OPENWAGGLE_EXTENSION.PATTERNS.SEMVER_COMPARATOR.exec(part)
    const versionText = match?.[OPENWAGGLE_EXTENSION.SEMVER_MATCH.COMPARATOR_VERSION]
    if (!versionText) {
      return null
    }
    const version = parseSemanticVersion(versionText)
    if (!version) {
      return null
    }
    range = mergeComparator(
      range,
      match[OPENWAGGLE_EXTENSION.SEMVER_MATCH.COMPARATOR_OPERATOR] ?? '=',
      version,
    )
  }
  return range
}

function parseSdkRange(value: string): VersionRange | 'any' | null {
  const trimmed = value.trim()
  if (trimmed === '*') {
    return 'any'
  }

  return (
    parseCaretRange(trimmed) ??
    parseTildeRange(trimmed) ??
    parseComparatorRange(trimmed) ??
    parseExactRange(trimmed)
  )
}

function hasInvalidBounds(range: VersionRange) {
  if (!range.min || !range.max) {
    return false
  }
  const compared = compareSemanticVersions(range.min, range.max)
  if (compared > 0) {
    return true
  }
  return compared === 0 && (range.minInclusive === false || range.maxInclusive === false)
}

export function checkExtensionSdkCompatibility(
  requiredRange: string,
  hostVersion: string,
): ExtensionSdkCompatibility {
  const parsedHostVersion = parseSemanticVersion(hostVersion)
  if (!parsedHostVersion) {
    return {
      hostVersion,
      requiredRange,
      compatible: false,
      reason: `Host SDK version "${hostVersion}" is not valid semver.`,
    }
  }

  const range = parseSdkRange(requiredRange)
  if (!range) {
    return {
      hostVersion,
      requiredRange,
      compatible: false,
      reason: `SDK range "${requiredRange}" is not supported.`,
    }
  }
  if (range === 'any') {
    return { hostVersion, requiredRange, compatible: true }
  }
  if (hasInvalidBounds(range)) {
    return {
      hostVersion,
      requiredRange,
      compatible: false,
      reason: `SDK range "${requiredRange}" has incompatible bounds.`,
    }
  }

  const compatible = versionSatisfiesRange(parsedHostVersion, range)
  return compatible
    ? { hostVersion, requiredRange, compatible: true }
    : {
        hostVersion,
        requiredRange,
        compatible: false,
        reason: `Host SDK ${hostVersion} does not satisfy ${requiredRange}.`,
      }
}
