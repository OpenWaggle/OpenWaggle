import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import {
  extensionContributionFamilySchema,
  extensionContributionIdSchema,
  extensionIdSchema,
} from './manifest.js'

export type {
  ExtensionContributionRegistration,
  ExtensionContributionUnregistration,
} from './manifest.js'
export {
  extensionContributionRegistrationSchema,
  extensionContributionUnregistrationSchema,
} from './manifest.js'
export { createRuntimeContributionSdk } from './runtime-sdk.js'
export type * from './runtime-types.js'

export const extensionRuntimeRegisterContributionResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION),
  family: extensionContributionFamilySchema,
  registeredContributionId: extensionContributionIdSchema,
})

export const extensionRuntimeUnregisterContributionResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION),
  family: extensionContributionFamilySchema,
  unregisteredContributionId: extensionContributionIdSchema,
  unregistered: Schema.Boolean,
})
