import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TanStackAIDevtools } from '@/components/devtools/TanStackAIDevtools'
import { AppErrorBoundary } from '@/components/shared/AppErrorBoundary'
import { rendererQueryClient } from '@/queries/query-client'
import { App } from './App'
import { getHighlighter } from './lib/shiki/highlighter'
import './styles/globals.css'

// Eagerly start loading Shiki so it's ready before the first message renders.
void getHighlighter()

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
