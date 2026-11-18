/**
 * The manifest and contribution types the SDK publishes, each inferred from its internal schema.
 * `scripts/generate-extension-sdk-types.ts` prints them into `src/generated/manifest.ts`, the
 * module the public entries export, so the published declarations name no Effect type.
 */
import type * as Contributions from '../manifest-contributions.js'
import type * as Manifest from '../manifest-schemas.js'
import type * as Primitives from '../manifest-primitives.js'
import type { SchemaType } from '../schema.js'

/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = SchemaType<typeof Primitives.extensionCapabilityScopeSchema>
/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily = SchemaType<
  typeof Primitives.extensionContributionFamilySchema
>
/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = SchemaType<
  typeof Primitives.extensionContributionRuntimeSchema
>
/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = SchemaType<
  typeof Primitives.extensionExecutionPlacementSchema
>
/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = SchemaType<typeof Manifest.extensionInstallSourceSchema>

/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = SchemaType<
  typeof Contributions.extensionContributionTargetSchema
>
/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = SchemaType<
  typeof Contributions.extensionContributionMatchSchema
>
/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = SchemaType<
  typeof Contributions.extensionCapabilityDeclarationSchema
>
/** A command or slash command. */
export type ExtensionCommandContribution = SchemaType<
  typeof Contributions.extensionCommandContributionSchema
>
/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = SchemaType<
  typeof Contributions.extensionRouteContributionSchema
>
/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = SchemaType<typeof Contributions.extensionSidePanelIconSchema>
/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = SchemaType<
  typeof Contributions.extensionSidePanelContributionSchema
>
/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution =
  | ExtensionSurfaceContribution
  | ExtensionSidePanelContribution
/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = SchemaType<
  typeof Contributions.extensionSessionSummaryRowSchema
>
/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = SchemaType<
  typeof Contributions.extensionSessionSummaryDisclosureSchema
>
/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState = SchemaType<
  typeof Contributions.extensionSessionSummaryStateSchema
>
/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = SchemaType<
  typeof Contributions.extensionSessionSummaryContributionSchema
>
/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = SchemaType<typeof Contributions.extensionContributionsSchema>
/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration = SchemaType<
  typeof Contributions.extensionContributionRegistrationSchema
>
/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = SchemaType<
  typeof Contributions.extensionContributionUnregistrationSchema
>
/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = SchemaType<
  typeof Manifest.extensionRuntimeRequirementSchema
>
/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = SchemaType<
  typeof Manifest.extensionDocsTopicDeclarationSchema
>
/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = SchemaType<
  typeof Manifest.openWaggleExtensionManifestSchema
>
