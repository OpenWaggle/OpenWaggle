# Desktop shell port contracts

One reusable suite per desktop shell port (ADR 0064). A suite takes a harness: the adapter under
test plus the hooks it needs to arrange and observe the shell (a window to own a dialog, an update
the feed offers, the system's clipboard). The Electrobun adapters run every suite in
`src/main/adapters/electrobun/__tests__/contracts/*.contract.unit.test.ts`, against a fake of the
Electrobun SDK (`fake-electrobun.ts`).

A suite states the port's promise in OpenWaggle's terms; it never asserts how a shell does it.
