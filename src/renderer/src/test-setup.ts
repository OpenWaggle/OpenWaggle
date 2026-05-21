import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// Polyfill ResizeObserver for jsdom (required by Lexical AutoResizePlugin)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof globalThis.HTMLCanvasElement !== 'undefined') {
  globalThis.HTMLCanvasElement.prototype.getContext = function getContext() {
    return null
  }
}

afterEach(() => {
  cleanup()
})
