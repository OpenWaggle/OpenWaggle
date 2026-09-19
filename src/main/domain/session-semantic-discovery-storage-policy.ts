export interface SessionSemanticDiscoveryStoragePolicy {
  readonly recordLimit: number
}

export const SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY = {
  recordLimit: 100_000,
} as const satisfies SessionSemanticDiscoveryStoragePolicy
