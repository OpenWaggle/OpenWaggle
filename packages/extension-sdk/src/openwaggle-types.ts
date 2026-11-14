import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js'

export type {
  ExtensionDocsDiscoverPayload,
  ExtensionDocsDiscoverResult,
  ExtensionDocsResolveTopicPayload,
  ExtensionDocsResolveTopicResult,
} from './generated/docs.js'
export type * from './generated/openwaggle.js'

/** The result of reading one state selector; each `ExtensionState*ReadResult` narrows it. */
export interface ExtensionSelectedStateReadResult<TValue> {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE
  readonly scope: ExtensionInvokeScope
  readonly selector: ExtensionStateSelector
  readonly value: TValue
}
