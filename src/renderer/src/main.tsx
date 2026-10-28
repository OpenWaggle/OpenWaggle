import '@xterm/xterm/css/xterm.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/shared/ui/AppErrorBoundary'
import { App } from './App'
import { startInitialRouteLoad } from './router'
import './shared/lib/appearance'
import { restoreCachedAppearancePreferences } from './shared/lib/appearance-preferences-runtime'
import './styles/globals.css'
import { startWindowErrorReporting } from './window-error-reporting'

// The startup skeleton paints in the last appearance before the Session Host answers.
restoreCachedAppearancePreferences()
// Fetch the launch route's chunks while the settings read is in flight (renderer-load B1).
void startInitialRouteLoad()

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
