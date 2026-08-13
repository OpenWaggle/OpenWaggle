import type { ReactElement } from 'react';
/**
 * Type guard to check if a React node is a ReactElement with accessible props.
 * Replaces `node as ReactElement<P>` casts in markdown rendering components.
 */
export declare function isReactElementWithProps<P>(node: unknown): node is ReactElement<P>;
