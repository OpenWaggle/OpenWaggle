import { contextBridge } from 'electron'
import { api } from './api'

/**
 * Expose the typed API to the renderer process.
 * Access it via `window.api` in React.
 */
contextBridge.exposeInMainWorld('api', api)
