import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

const TEST_OBJECT_URL_PREFIX = 'blob:openwaggle-test-object-url-'
const INITIAL_TEST_OBJECT_URL_SEQUENCE = 0
const TEST_OBJECT_URL_SEQUENCE_INCREMENT = 1
let testObjectUrlSequence = INITIAL_TEST_OBJECT_URL_SEQUENCE

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

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = function createObjectURL() {
    testObjectUrlSequence += TEST_OBJECT_URL_SEQUENCE_INCREMENT
    return `${TEST_OBJECT_URL_PREFIX}${testObjectUrlSequence}`
  }
}

if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = function revokeObjectURL() {}
}

afterEach(() => {
  cleanup()
})
