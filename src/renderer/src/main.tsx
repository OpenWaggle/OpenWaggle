import '@xterm/xterm/css/xterm.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/shared/ui/AppErrorBoundary'
import { App } from './App'
import './shared/lib/appearance'
import './styles/globals.css'
import { startWindowErrorReporting } from './window-error-reporting'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

// Off the first render, and off until this window's Settings have Usage statistics on.
startWindowErrorReporting()
