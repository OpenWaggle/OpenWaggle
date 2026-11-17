# Windows builds ship unsigned until a signer is funded

Windows builds of the desktop app stay unsigned for v1, which matches the existing rule that Windows signing does not block `1.0.0`. The free path closed in November 2026: the SignPath Foundation reviewed the project's application and declined it, because the Foundation program looks for public visibility signals such as community adoption, outside articles or discussion, or institutional backing, and the project does not have enough of them yet. They invited a reapplication once it does. Two signer paths therefore stay open behind named triggers, and nothing else about the release changes.

## Considered Options

- **Buy a certificate now.** Rejected on cost. No certificate removes the first-download warning either, so paying only changes whose name the warning shows and lets reputation carry between releases. Azure Artifact Signing Basic is 9.99 USD per month (5,000 signatures, individual identity validation, no hardware token), and it becomes the paid path when a sponsor covers it or when the warning measurably costs Windows installs.
- **Reapply to the SignPath Foundation.** Free, and still the intended path, gated on the visibility signals the Foundation named. Reapply when the project has them.
- **Publish through the Microsoft Store.** The only free route with no SmartScreen warning at all, because Microsoft re-signs Store apps. Rejected for now: it is a second release pipeline, not a signing change. It needs MSIX packaging, Store certification, a Store-owned update path the in-app updater must not bypass, and a developer account whose Individual type cannot later convert to Company.
- **An EV certificate.** Rejected permanently. Microsoft's SmartScreen documentation states EV no longer bypasses SmartScreen, and that paying a premium for EV to avoid warnings is no longer justified.

## Consequences

- The first install of every version shows "Windows protected your PC" with an unknown publisher. Microsoft documents that an unsigned file starts at zero reputation and cannot carry reputation to the next version, so the warning never stops appearing on its own, however popular the app becomes.
- Enterprise policy can remove the option to continue past the warning, so some Windows machines cannot install an unsigned build at all.
- `SHA256SUMS.txt`, which the release already publishes, is the trust anchor that stands in for a publisher signature. It covers every artifact including the Windows installer, so the install page tells readers to check it.
- Any later signer switch resets SmartScreen certificate reputation once. `verifyUpdateCodeSignature` compares the Authenticode publisher against `publisherName`, so the signing identity has to be as long-lived as the macOS team identity.
- Wiring a signer later mirrors `resolveMacSigning` in `scripts/mac-signing.ts`: a `scripts/win-signing.ts`, a fail-closed release candidate and Stable secrets gate in `release.yml`, an unsigned nightly, and an Authenticode verification step.
