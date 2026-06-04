import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema, type SchemaType } from '@shared/schema'

function isNonEmptyTrimmed(value: string) {
  return value.trim().length > 0 || 'Must not be empty.'
}

function isExtensionId(value: string) {
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.ID_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.ID_MAX_LENGTH} characters.`
  }
  return (
    OPENWAGGLE_EXTENSION.PATTERNS.ID.test(value) ||
    'Use lowercase letters, numbers, dots, underscores, and dashes; start with a letter or number.'
  )
}

function isContributionId(value: string) {
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.CONTRIBUTION_ID_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.CONTRIBUTION_ID_MAX_LENGTH} characters.`
  }
  return (
    OPENWAGGLE_EXTENSION.PATTERNS.CONTRIBUTION_ID.test(value) ||
    'Use lowercase letters, numbers, dots, underscores, dashes, and forward slashes; start with a letter or number.'
  )
}

function isSemverVersion(value: string) {
  return (
    OPENWAGGLE_EXTENSION.PATTERNS.SEMVER_VERSION.test(value) ||
    'Must be a semantic version such as 1.2.3.'
  )
}

function isPortableRelativePath(value: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'Must not be empty.'
  }
  if (value !== trimmed) {
    return 'Must not have leading or trailing whitespace.'
  }
  if (trimmed.length > OPENWAGGLE_EXTENSION.LIMITS.RELATIVE_PATH_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.RELATIVE_PATH_MAX_LENGTH} characters.`
  }
  if (trimmed.includes(OPENWAGGLE_EXTENSION.PATH.NUL_CHARACTER)) {
    return 'Must not contain NUL bytes.'
  }
  if (
    trimmed.startsWith(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR) ||
    trimmed.startsWith(OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR) ||
    OPENWAGGLE_EXTENSION.PATTERNS.WINDOWS_ABSOLUTE_PATH.test(trimmed)
  ) {
    return 'Must be relative to the extension package root.'
  }

  const segments = trimmed
    .replaceAll(
      OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
      OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
    )
    .split(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR)
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === OPENWAGGLE_EXTENSION.PATH.CURRENT_DIRECTORY_SEGMENT ||
        segment === OPENWAGGLE_EXTENSION.PATH.RELATIVE_PARENT_SEGMENT,
    )
  ) {
    return 'Must not contain empty, "." or ".." path segments.'
  }

  return true
}

function isBuildCommand(value: string) {
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.BUILD_COMMAND_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.BUILD_COMMAND_MAX_LENGTH} characters.`
  }
  if (value.includes(OPENWAGGLE_EXTENSION.PATH.NUL_CHARACTER)) {
    return 'Must not contain NUL bytes.'
  }
  if (value.includes('\n') || value.includes('\r')) {
    return 'Must be a single command line.'
  }
  return true
}

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter(isNonEmptyTrimmed))

export const extensionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isExtensionId),
)
export const extensionContributionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isContributionId),
)
export const extensionRelativePathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isPortableRelativePath),
)
export const extensionSemverVersionSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isSemverVersion),
)

export const extensionCapabilityScopeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES,
)
export const extensionUiLaneSchema = Schema.Literal(...OPENWAGGLE_EXTENSION.UI_LANES)
export const extensionContributionFamilySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILIES,
)
export const extensionInstallSourceSchema = Schema.Literal(...OPENWAGGLE_EXTENSION.INSTALL_SOURCES)
export const extensionLifecycleScopeSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal(OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND),
  }),
  Schema.Struct({
    kind: Schema.Literal(OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND),
    projectPath: nonEmptyStringSchema,
  }),
)

const extensionViewProjectPathsSchema = Schema.mutable(Schema.Array(nonEmptyStringSchema))

export const extensionListPackagesInputSchema = Schema.Struct({
  projectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export const extensionCapabilityDeclarationSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  methods: Schema.optional(Schema.mutable(Schema.Array(extensionContributionIdSchema))),
  scopes: Schema.optional(Schema.mutable(Schema.Array(extensionCapabilityScopeSchema))),
})

const extensionContributionBrokerBindingSchema = {
  capability: Schema.optional(extensionContributionIdSchema),
  method: Schema.optional(extensionContributionIdSchema),
  methods: Schema.optional(Schema.mutable(Schema.Array(extensionContributionIdSchema))),
}

export const extensionCommandContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  category: Schema.optional(
    nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  ),
  ...extensionContributionBrokerBindingSchema,
})

export const extensionRouteContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  lane: extensionUiLaneSchema,
  entry: extensionRelativePathSchema,
  ...extensionContributionBrokerBindingSchema,
})

export const extensionSlotContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  lane: extensionUiLaneSchema,
  entry: extensionRelativePathSchema,
  ...extensionContributionBrokerBindingSchema,
})

export const extensionContributionsSchema = Schema.Struct({
  commands: Schema.optional(Schema.mutable(Schema.Array(extensionCommandContributionSchema))),
  slashCommands: Schema.optional(Schema.mutable(Schema.Array(extensionCommandContributionSchema))),
  routes: Schema.optional(Schema.mutable(Schema.Array(extensionRouteContributionSchema))),
  settingsSections: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
  sidePanels: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
  dialogs: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
  transcriptRenderers: Schema.optional(
    Schema.mutable(Schema.Array(extensionSlotContributionSchema)),
  ),
  statusWidgets: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
})

export const extensionRuntimeRequirementSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  label: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  command: Schema.optional(extensionRelativePathSchema),
})

export const extensionInstallSchema = Schema.Struct({
  source: extensionInstallSourceSchema,
})

export const extensionBuildSchema = Schema.Struct({
  command: nonEmptyStringSchema.pipe(Schema.filter(isBuildCommand)),
  outputs: Schema.optional(Schema.mutable(Schema.Array(extensionRelativePathSchema))),
})

export const openWaggleExtensionManifestSchema = Schema.Struct({
  manifestVersion: Schema.Literal(1),
  id: extensionIdSchema,
  name: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  version: extensionSemverVersionSchema,
  description: Schema.optional(
    nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH)),
  ),
  sdk: Schema.Struct({
    openwaggle: nonEmptyStringSchema,
  }),
  sourceFiles: Schema.mutable(Schema.Array(extensionRelativePathSchema)),
  builtArtifacts: Schema.mutable(Schema.Array(extensionRelativePathSchema)),
  install: Schema.optional(extensionInstallSchema),
  build: Schema.optional(extensionBuildSchema),
  capabilities: Schema.optional(Schema.mutable(Schema.Array(extensionCapabilityDeclarationSchema))),
  contributions: Schema.optional(extensionContributionsSchema),
  pi: Schema.optional(
    Schema.Struct({
      resourceRoots: Schema.optional(Schema.mutable(Schema.Array(extensionRelativePathSchema))),
    }),
  ),
  trusted: Schema.optional(
    Schema.Struct({
      main: Schema.optional(extensionRelativePathSchema),
      renderer: Schema.optional(extensionRelativePathSchema),
    }),
  ),
  runtimeRequirements: Schema.optional(
    Schema.mutable(Schema.Array(extensionRuntimeRequirementSchema)),
  ),
})

export const extensionSetTrustedInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  trusted: Schema.Boolean,
})

export const extensionSetEnabledInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  enabled: Schema.Boolean,
})

export const extensionSetProjectDisabledInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  projectPath: nonEmptyStringSchema,
  disabled: Schema.Boolean,
})

export const extensionAcceptUpdateInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export const extensionApproveBuildInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export const extensionReloadInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export type OpenWaggleExtensionManifest = SchemaType<typeof openWaggleExtensionManifestSchema>
export type ExtensionCapabilityDeclaration = SchemaType<typeof extensionCapabilityDeclarationSchema>
export type ExtensionContributions = SchemaType<typeof extensionContributionsSchema>
