/**
 * Domain-owned opaque type wrapping a vendor chat adapter.
 *
 * The agent loop and application services pass `ChatAdapter` around
 * without knowing its internal structure. Only the TanStack AI adapter
 * layer unwraps it to access the real `AnyTextAdapter`.
 */
import { Brand } from 'effect'

/**
 * Branded opaque wrapper for vendor chat adapters.
 * Created by provider `createAdapter()`, consumed by `ChatService.stream()`.
 */
export type ChatAdapter = { readonly _inner: unknown } & Brand.Brand<'ChatAdapter'>

const ChatAdapterBrand = Brand.nominal<ChatAdapter>()

/** Wrap a vendor adapter as a domain-owned `ChatAdapter`. */
export function wrapChatAdapter(inner: unknown): ChatAdapter {
  return ChatAdapterBrand({ _inner: inner })
}

/** Unwrap a `ChatAdapter` to access the underlying vendor adapter. */
export function unwrapChatAdapter(adapter: ChatAdapter): unknown {
  return adapter._inner
}
