import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

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

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[PanelErrorBoundary:${this.props.name}]`, error, errorInfo)
  }

  private readonly handleRetry = (): void => {
    this.setState({ hasError: false, message: null })
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.className ? (
        <div className={this.props.className}>{this.props.children}</div>
      ) : (
        this.props.children
      )
    }

    return (
      <div className={cn('flex items-center justify-center p-4', this.props.className)}>
        <div className="w-full max-w-sm rounded-lg border border-error/30 bg-bg-secondary p-4">
          <div className="mb-2 flex items-center gap-2 text-error">
            <AlertTriangle className="h-3.5 w-3.5" />
            <h2 className="text-[13px] font-semibold">{this.props.name} panel error</h2>
          </div>
          {this.state.message && (
            <p className="mb-3 text-[12px] text-text-tertiary break-words">{this.state.message}</p>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent/12 px-2.5 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    )
  }
}
