import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from './Button'

const logger = createRendererLogger('PanelErrorBoundary')

interface PanelErrorBoundaryProps {
  readonly name: string
  readonly children: ReactNode
  readonly className?: string
}

interface PanelErrorBoundaryState {
  readonly hasError: boolean
  readonly message: string | null
}

/**
 * Granular error boundary for individual UI panels.
 * Unlike AppErrorBoundary (full-page crash), this renders a compact
 * inline card and lets the user retry without reloading the entire app.
 */
export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  override state: PanelErrorBoundaryState = {
    hasError: false,
    message: null,
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message,
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(`Panel "${this.props.name}" error`, {
      message: error.message,
      stack: errorInfo.componentStack,
    })
  }

  private readonly handleRetry = () => {
    this.setState({ hasError: false, message: null })
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.className ? (
        <div className={this.props.className}>{this.props.children}</div>
      ) : (
        this.props.children
      )
    }

    return (
      <div
        role="alert"
        className={cn('flex items-center justify-center p-4', this.props.className)}
      >
        <div className="w-full max-w-sm rounded-lg border border-error/30 bg-bg-secondary p-4">
          <div className="mb-2 flex items-center gap-2 text-error">
            <AlertTriangle className="size-3.5" />
            <h2 className="text-[13px] font-semibold">{this.props.name} panel error</h2>
          </div>
          {this.state.message && (
            <p className="mb-3 text-[12px] text-text-tertiary break-words">{this.state.message}</p>
          )}
          <Button variant="accent" size="xs" aria-label="Retry" onClick={this.handleRetry}>
            <RefreshCw className="size-3" />
            Retry
          </Button>
        </div>
      </div>
    )
  }
}
