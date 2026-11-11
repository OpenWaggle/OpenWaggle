/**
 * What `electrobun/main` and `electrobun/main/events` resolve to under Vitest. Electrobun 2.x
 * ships its SDK in the Hutch devkit, not in node_modules, and the SDK opens Electrobun's native
 * library when it loads, so a test mocks it (`prepareElectrobunShell()` in
 * src/main/adapters/electrobun/__tests__/contracts/electrobun-shell.ts) and never loads this.
 */
throw new Error('Mock electrobun/main in this test: see prepareElectrobunShell().')
