/**
 * Validation helpers for extension tooling and tests: build scripts, manifest checks and theme
 * doubles. Each `validate*` helper returns an `ExtensionValidationResult` and never throws. This
 * entry bundles the SDK's validator, so extension code that runs inside OpenWaggle should not
 * import it.
 */
import { extensionCapabilityDeclarationSchema } from './internal/manifest-contributions.js'
import { openWaggleExtensionManifestSchema } from './internal/manifest-schemas.js'
import { validateWithSchema } from './internal/schema.js'
import { extensionThemeSchema } from './internal/theme-schemas.js'
import type {
  ExtensionCapabilityDeclaration,
  OpenWaggleExtensionManifest,
} from './generated/manifest.js'
import type { OpenWaggleExtensionTheme } from './theme-types.js'
import type { ExtensionValidationResult } from './validation-types.js'

export type { ExtensionValidationIssue, ExtensionValidationResult } from './validation-types.js'

// Each helper is typed as a value so the published declarations name the public type it returns
// instead of spelling out the schema's.

/** Checks an `openwaggle.extension.json` manifest the way OpenWaggle does when it loads one. */
export const validateExtensionManifest: (
  value: unknown,
) => ExtensionValidationResult<OpenWaggleExtensionManifest> = (value) =>
  validateWithSchema(openWaggleExtensionManifestSchema, value)

/**
 * Checks one entry of a manifest's `capabilities`: its shape, and for a built-in broker capability
 * that it declares at least one method and only methods the broker supports.
 */
export const validateBrokerCapabilityDeclaration: (
  value: unknown,
) => ExtensionValidationResult<ExtensionCapabilityDeclaration> = (value) =>
  validateWithSchema(extensionCapabilityDeclarationSchema, value)

/**
 * Checks a theme object: its colour scheme, and that `tokens` and `cssVariables` hold exactly the
 * token groups and keys of the current theme contract. The theme itself may carry more fields,
 * which `value` leaves out.
 */
export const validateOpenWaggleExtensionTheme: (
  value: unknown,
) => ExtensionValidationResult<OpenWaggleExtensionTheme> = (value) =>
  validateWithSchema(extensionThemeSchema, value)
