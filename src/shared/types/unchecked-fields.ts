/**
 * The fields of `T` that a tolerant reader looks at, each still unchecked. Assigning an object to
 * it declares which keys the code reads, by the names of the type it builds, so each one is read
 * with dot access and narrowed on its own. Use a schema from src/shared/schema when the whole value
 * must be valid; use this when one bad field must not discard the others (tool arguments a model
 * wrote, display hints).
 */
export type UncheckedFields<T> = { readonly [K in keyof T]?: unknown }
