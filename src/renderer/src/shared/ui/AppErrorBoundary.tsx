import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from './Button'

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

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message,
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Unhandled render error', {
      message: error.message,
      stack: errorInfo.componentStack,
    })
  }

  private readonly handleReload = () => {
    window.location.reload()
  }

  override render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div role="alert" className="flex size-full items-center justify-center bg-bg px-6">
        <div className="w-full max-w-md rounded-xl border border-error/30 bg-bg-secondary p-5">
          <div className="mb-3 flex items-center gap-2 text-error">
            <AlertTriangle className="size-4" />
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
          <Button
            variant="accent"
            aria-label="Reload app"
            onClick={this.handleReload}
            className="mt-4"
          >
            <RefreshCw className="size-3" />
            Reload app
          </Button>
        </div>
      </div>
    )
  }
}
