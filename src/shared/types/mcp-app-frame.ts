/** The network origins an App's frame may use, as its server declared them (ADR 0053). */
export interface McpAppCsp {
  readonly connectDomains: readonly string[]
  readonly resourceDomains: readonly string[]
  readonly frameDomains: readonly string[]
  readonly baseUriDomains: readonly string[]
}

/** An App document the renderer asks the Host to serve under its own frame origin. */
export interface McpAppFrameRegisterInput {
  readonly frameId: string
  /** The App's HTML as the server sent it. */
  readonly html: string
  readonly csp: McpAppCsp
}

export interface McpAppFrameRegisterResult {
  readonly frameUrl: string
  readonly registrationId: string
}

export interface McpAppFrameUnregisterInput {
  readonly frameId: string
  readonly registrationId: string
}
