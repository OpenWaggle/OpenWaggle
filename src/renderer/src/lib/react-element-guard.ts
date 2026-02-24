import type { ReactElement, ReactNode } from 'react'

/**
 * Type guard to check if a React node is a ReactElement with accessible props.
 * Replaces `node as ReactElement<P>` casts in markdown rendering components.
 */
export function isReactElementWithProps<P>(node: ReactNode): node is ReactElement<P> {
  return node !== null && typeof node === 'object' && !Array.isArray(node) && 'props' in node
}
