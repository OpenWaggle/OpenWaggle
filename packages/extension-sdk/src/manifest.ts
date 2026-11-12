import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION } from './constants.js'
import {
  extensionCapabilityDeclarationSchema,
  extensionContributionsSchema,
} from './manifest-contributions.js'
import {
  extensionContributionIdSchema,
  extensionIdSchema,
  extensionNonEmptyStringSchema,
  extensionRelativePathSchema,
  extensionSemverVersionSchema,
  isBuildCommand,
  isNetworkOrigin,
  isRuntimeRequirementBinary,
} from './manifest-primitives.js'
import { type SchemaType, safeDecodeExtensionSchema } from './schema.js'

export * from './manifest-contributions.js'
export {
  extensionCapabilityScopeSchema,
  extensionCommandContributionFamilySchema,
  extensionContributionFamilySchema,
  extensionContributionIdSchema,
  extensionContributionRuntimeSchema,
  extensionExecutionPlacementSchema,
  extensionIdSchema,
  extensionRelativePathSchema,
  extensionSemverVersionSchema,
  extensionSlotContributionFamilySchema,
} from './manifest-primitives.js'

export const extensionRuntimeRequirementTypeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPES,
)
export const extensionRuntimeRequirementSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  label: extensionNonEmptyStringSchema.pipe(
    Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
  ),
  kind: Schema.optionalWith(extensionRuntimeRequirementTypeSchema, { exact: true }),
  command: Schema.optionalWith(extensionRelativePathSchema, { exact: true }),
  binary: Schema.optionalWith(
    extensionNonEmptyStringSchema.pipe(Schema.filter(isRuntimeRequirementBinary)),
    { exact: true },
  ),
}).pipe(
  Schema.filter((requirement) => {
    const hasBinary = requirement.binary !== undefined
    const hasCommand = requirement.command !== undefined
    if (hasBinary === hasCommand) {
      return 'Declare exactly one runtime requirement target: binary or command.'
    }
    if (
      hasBinary &&
      requirement.kind !== undefined &&
      requirement.kind !== OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPE.BINARY
    ) {
      return 'Runtime requirement kind must be "binary" when binary is declared.'
    }
    if (
      hasCommand &&
      requirement.kind !== undefined &&
      requirement.kind !== OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPE.COMMAND
    ) {
      return 'Runtime requirement kind must be "command" when command is declared.'
    }
    return true
  }),
)

export const extensionInstallSourceSchema = Schema.Literal(...OPENWAGGLE_EXTENSION.INSTALL_SOURCES)
export const extensionInstallSchema = Schema.Struct({ source: extensionInstallSourceSchema })
export const extensionBuildSchema = Schema.Struct({
  command: extensionNonEmptyStringSchema.pipe(Schema.filter(isBuildCommand)),
  outputs: Schema.optionalWith(Schema.Array(extensionRelativePathSchema), { exact: true }),
})
export const extensionNetworkSchema = Schema.Struct({
  origins: Schema.Array(extensionNonEmptyStringSchema.pipe(Schema.filter(isNetworkOrigin))),
})
export const extensionDocsTopicDeclarationSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: extensionNonEmptyStringSchema.pipe(
    Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
  ),
  path: extensionRelativePathSchema,
  description: Schema.optionalWith(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH),
    ),
    { exact: true },
  ),
  aliases: Schema.optionalWith(Schema.Array(extensionNonEmptyStringSchema), { exact: true }),
  keywords: Schema.optionalWith(Schema.Array(extensionNonEmptyStringSchema), { exact: true }),
})
export const extensionDocsSchema = Schema.Struct({
  topics: Schema.optionalWith(Schema.Array(extensionDocsTopicDeclarationSchema), { exact: true }),
})

interface TrustedRendererBoundaryInput {
  readonly trusted?: { readonly renderer?: string }
  readonly contributions?: Readonly<
    Partial<
      Record<
        (typeof OPENWAGGLE_EXTENSION.ENTRY_CONTRIBUTION_FAMILIES)[number],
        readonly { readonly runtime?: string }[] | undefined
      >
    >
  >
}

function validateTrustedRendererRuntimeBoundary(manifest: TrustedRendererBoundaryInput) {
  const usesTrustedRenderer = OPENWAGGLE_EXTENSION.ENTRY_CONTRIBUTION_FAMILIES.some((family) =>
    manifest.contributions?.[family]?.some(
      (contribution) =>
        contribution.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER,
    ),
  )
  return (
    !usesTrustedRenderer ||
    manifest.trusted?.renderer !== undefined ||
    'Trusted renderer contributions require trusted.renderer to declare privileged renderer runtime execution.'
  )
}

export const openWaggleExtensionManifestSchema = Schema.Struct({
  manifestVersion: Schema.Literal(1),
  id: extensionIdSchema,
  name: extensionNonEmptyStringSchema.pipe(
    Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
  ),
  version: extensionSemverVersionSchema,
  description: Schema.optionalWith(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH),
    ),
    { exact: true },
  ),
  sdk: Schema.Struct({ openwaggle: extensionNonEmptyStringSchema }),
  sourceFiles: Schema.Array(extensionRelativePathSchema),
  builtArtifacts: Schema.Array(extensionRelativePathSchema),
  install: Schema.optionalWith(extensionInstallSchema, { exact: true }),
  build: Schema.optionalWith(extensionBuildSchema, { exact: true }),
  docs: Schema.optionalWith(extensionDocsSchema, { exact: true }),
  network: Schema.optionalWith(extensionNetworkSchema, { exact: true }),
  capabilities: Schema.optionalWith(Schema.Array(extensionCapabilityDeclarationSchema), {
    exact: true,
  }),
  contributions: Schema.optionalWith(extensionContributionsSchema, { exact: true }),
  pi: Schema.optionalWith(
    Schema.Struct({
      resourceRoots: Schema.optionalWith(Schema.Array(extensionRelativePathSchema), {
        exact: true,
      }),
    }),
    { exact: true },
  ),
  trusted: Schema.optionalWith(
    Schema.Struct({
      main: Schema.optionalWith(extensionRelativePathSchema, { exact: true }),
      renderer: Schema.optionalWith(extensionRelativePathSchema, { exact: true }),
    }),
    { exact: true },
  ),
  runtimeRequirements: Schema.optionalWith(Schema.Array(extensionRuntimeRequirementSchema), {
    exact: true,
  }),
}).pipe(Schema.filter(validateTrustedRendererRuntimeBoundary))

export type ExtensionRuntimeRequirementDeclaration = SchemaType<
  typeof extensionRuntimeRequirementSchema
>
export type ExtensionDocsTopicDeclaration = SchemaType<typeof extensionDocsTopicDeclarationSchema>
export type OpenWaggleExtensionManifest = SchemaType<typeof openWaggleExtensionManifestSchema>
export type OpenWaggleExtensionManifestFile = typeof OPENWAGGLE_EXTENSION.MANIFEST_FILE

export type ExtensionManifestValidationResult =
  | { readonly success: true; readonly manifest: OpenWaggleExtensionManifest }
  | { readonly success: false; readonly issues: readonly string[] }

export function defineExtensionManifest<const TManifest extends OpenWaggleExtensionManifest>(
  manifest: TManifest,
) {
  return manifest
}

export function validateExtensionManifest(value: unknown): ExtensionManifestValidationResult {
  const result = safeDecodeExtensionSchema(openWaggleExtensionManifestSchema, value)
  return result.success
    ? { success: true, manifest: result.data }
    : { success: false, issues: result.issues }
}
