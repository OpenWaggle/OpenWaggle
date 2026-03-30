/**
 * Type augmentation for @tanstack/ai's chat() function.
 *
 * The vendor chat() has generic overloads that constrain message/tool array
 * types based on the adapter's generic params. When used from the hexagonal
 * adapter boundary (which passes domain unknown[] arrays), no overload matches.
 *
 * This augmentation adds a permissive overload that accepts unknown[] arrays
 * when using AnyTextAdapter. It is only consumed by the TanStack chat adapter
 * module — domain code never calls chat() directly.
 */
import type { AnyTextAdapter, ModelMessage, StreamChunk } from '@tanstack/ai'

declare module '@tanstack/ai' {
  /** Permissive overload for hexagonal adapter boundary (domain unknown[] → vendor types) */
  export function chat(options: {
    readonly adapter: AnyTextAdapter
    readonly messages: unknown[]
    readonly systemPrompts?: string[]
    readonly tools?: unknown[]
    readonly agentLoopStrategy?: unknown
    readonly abortController?: AbortController
    readonly [key: string]: unknown
  }): AsyncIterable<StreamChunk>

  /** Permissive overload for continuation adapter boundary */
  export function convertMessagesToModelMessages(messages: unknown[]): ModelMessage[]
}
