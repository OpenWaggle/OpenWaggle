import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from '@/shared/ui/AppErrorBoundary';
import { App } from './App';
import { getHighlighter } from './shared/lib/shiki/highlighter';
import './styles/globals.css';
// Eagerly start loading Shiki so it's ready before the first message renders.
void getHighlighter();
const root = document.getElementById('root');
if (!root)
    throw new Error('Root element not found');
createRoot(root).render(_jsx(StrictMode, { children: _jsx(AppErrorBoundary, { children: _jsx(App, {}) }) }));
