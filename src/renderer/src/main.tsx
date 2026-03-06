import 'highlight.js/styles/github-dark.min.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TanStackAIDevtools } from '@/components/devtools/TanStackAIDevtools'
import { AppErrorBoundary } from '@/components/shared/AppErrorBoundary'
import { rendererQueryClient } from '@/queries/query-client'
import { App } from './App'
import './styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={rendererQueryClient}>
      <AppErrorBoundary>
        <App />
        <TanStackAIDevtools />
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
)
