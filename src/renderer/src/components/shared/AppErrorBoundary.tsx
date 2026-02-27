import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('AppErrorBoundary')

interface AppErrorBoundaryProps {
  readonly children: ReactNode
}

interface AppErrorBoundaryState {
  readonly hasError: boolean
  readonly message: string | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = {
    hasError: false,
    message: null,
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('Unhandled render error', {
      message: error.message,
      stack: errorInfo.componentStack,
    })
  }

  private readonly handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div role="alert" className="flex h-full w-full items-center justify-center bg-bg px-6">
        <div className="w-full max-w-md rounded-xl border border-error/30 bg-bg-secondary p-5">
          <div className="mb-3 flex items-center gap-2 text-error">
            <AlertTriangle className="h-4 w-4" />
            <h1 className="text-sm font-semibold">Something went wrong</h1>
          </div>
          <p className="text-[13px] text-text-secondary">
            The renderer hit an unexpected error. You can reload to recover.
          </p>
          {this.state.message && (
            <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-bg p-2 text-[12px] text-text-tertiary whitespace-pre-wrap break-words">
              {this.state.message}
            </pre>
          )}
          <button
            type="button"
            aria-label="Reload app"
            onClick={this.handleReload}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent/12 px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent/20 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
