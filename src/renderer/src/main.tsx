import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '@/shared/ui/AppErrorBoundary'
import { App } from './App'
import { getHighlighter } from './shared/lib/shiki/highlighter'
import './styles/globals.css'

// Eagerly start loading Shiki so it's ready before the first message renders.
void getHighlighter()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
