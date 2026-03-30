/**
 * Domain-owned server tool types.
 *
 * These replace TanStack AI's `ServerTool` in domain-facing code that only
 * needs tool metadata (name, description, approval). The actual tool execution
 * uses vendor `ServerTool` internally — `DomainServerTool` is a structural
 * supertype that `ServerTool` satisfies without conversion.
 */

/**
 * Minimal domain-owned tool interface. Any vendor `ServerTool` is assignable
 * to this type because it requires strictly fewer fields.
 *
 * Code that only reads tool metadata (feature registry, prompt builder,
 * without-approval, tool registry) should use this type instead of `ServerTool`.
 */
export interface DomainServerTool {
  readonly name: string
  readonly description: string
  readonly needsApproval?: boolean
  readonly inputSchema?: unknown
  readonly outputSchema?: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
  /** Tool execution function — typed permissively for structural compatibility with vendor ServerTool. */
  execute?(...args: never[]): unknown
}

/**
 * A DomainServerTool preserving the literal name for type-level extraction.
 */
export interface NamedDomainServerTool<TName extends string> extends DomainServerTool {
  readonly name: TName
}
