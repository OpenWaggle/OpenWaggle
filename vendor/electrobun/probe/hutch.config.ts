// Pinned to the Electrobun release vendor/electrobun/VERSION builds. CI points
// HUTCH_ELECTROBUN_DEVKIT_ROOT at the rebuilt devkit, so the probe packages
// OpenWaggle's native layer rather than the stock release binaries.
export default {
  electrobun: { version: '2.0.6' },
  scripts: {
    build: ['hutch', 'electrobun', 'build', '--env=stable'],
  },
}
