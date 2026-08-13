/**
 * Structured logger for the renderer process.
 * Mirrors the main-process logger API for consistency.
 *
 * In dev: outputs to browser console with namespace prefix.
 * In prod: errors are forwarded to main process via IPC for aggregation.
 */
import type { Logger } from '@shared/types/logger';
export declare function createRendererLogger(namespace: string): Logger;
