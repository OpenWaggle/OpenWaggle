// Generated from src/internal/type-sources/broker.ts by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

/** Why a broker call failed. */
export type ExtensionInvokeFailureCode =
  | 'disabled-extension'
  | 'invalid-input'
  | 'invalid-payload'
  | 'out-of-scope'
  | 'transport-failed'
  | 'undeclared-capability'
  | 'undeclared-method'
  | 'undeclared-scope'
  | 'unknown-contribution'
  | 'unknown-extension'
  | 'unsupported-capability'
  | 'unsupported-method'

/** Whether the broker ran a call or refused it. */
export type ExtensionInvokeOutcome = 'rejected' | 'succeeded'

/** Where a broker call applies: the app, a project, a session or a branch. */
export type ExtensionInvokeScope =
  | { readonly kind: 'app' }
  | {
      readonly kind: 'branch'
      readonly projectPath: string
      readonly sessionId: string
      readonly branchId: string
    }
  | { readonly kind: 'project'; readonly projectPath: string }
  | { readonly kind: 'session'; readonly projectPath: string; readonly sessionId: string }

/** One broker call as the host receives it. */
export type ExtensionInvokeInput = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly payload?: unknown
}

/** Why the broker refused or failed a call. */
export type ExtensionInvokeError = {
  readonly code: ExtensionInvokeFailureCode
  readonly message: string
  readonly issues?: readonly string[]
}

/** The audit record the broker keeps for every call. */
export type ExtensionCapabilityAuditEntry = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly outcome: ExtensionInvokeOutcome
  readonly timestamp: number
  readonly failureCode?: ExtensionInvokeFailureCode
}

/** A broker call that failed. */
export type ExtensionInvokeFailure = {
  readonly ok: false
  readonly error: ExtensionInvokeError
  readonly audit?: ExtensionCapabilityAuditEntry
}

/** The result of `hostContext.getScope`: the scope the host resolved for the contribution. */
export type ExtensionHostContextResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.host.context'
  readonly method: 'get-scope'
  readonly scope: ExtensionInvokeScope
  readonly declaredScopes: readonly ('app' | 'branch' | 'project' | 'session')[]
}
