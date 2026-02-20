import 'highlight.js/styles/github-dark.min.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TanStackAIDevtools } from '@/components/devtools/TanStackAIDevtools'
import { AppErrorBoundary } from '@/components/shared/AppErrorBoundary'
import { App } from './App'
import './styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      <TanStackAIDevtools />
    </AppErrorBoundary>
  </StrictMode>,
)
