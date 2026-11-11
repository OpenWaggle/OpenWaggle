/**
 * Hutch project pin (ADR 0064). The Electrobun SDK, runtime and native layer the desktop shell
 * builds against; it must match vendor/electrobun/VERSION. `bunx electrobun prepare` writes the
 * devkit to `.hutch/devkit`, which the main build bundles and vendor/electrobun/api-types.ts reads.
 */
export default {
  electrobun: { version: '2.0.6' },
}
