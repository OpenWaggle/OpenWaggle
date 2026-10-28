import { lazyModule } from '../utils/lazy-module'

/**
 * sharp and libvips load on the first image decode or thumbnail, not when the main bundle starts
 * (A-F4). The attachment parser worker imports the same ESM entry.
 */
export const loadSharp = lazyModule(() => import('sharp').then((module) => module.default))
