import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/**
 * A Pi `ExtensionFactory` that registers everything before it returns. Pi awaits any factory, so
 * this is assignable where Pi takes one, and a caller composing or testing it has no promise to
 * await.
 */
export type SynchronousExtensionFactory = (pi: ExtensionAPI) => void
