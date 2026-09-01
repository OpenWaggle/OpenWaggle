import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/shared/ui/AppErrorBoundary'
import { App } from './App'
import './shared/lib/appearance'
import './styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
