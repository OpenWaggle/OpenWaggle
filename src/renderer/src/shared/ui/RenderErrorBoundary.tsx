import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('RenderErrorBoundary')

interface RenderErrorBoundaryProps {
  /** Names the surface in the log entry. */
  readonly name: string
  /** Rendered in place of the children once they throw. */
  readonly fallback: ReactNode
  readonly children: ReactNode
}

/**
 * Swaps a subtree that throws while rendering for a quiet fallback, so one broken
 * item degrades in place instead of failing the panel around it. Unlike
 * `PanelErrorBoundary` it shows no error card and offers no retry.
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  { readonly failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.warn(`"${this.props.name}" failed to render; showing its fallback`, {
      message: error.message,
      stack: errorInfo.componentStack,
    })
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
