---
name: pi-integration
description: OpenWaggle-specific Pi runtime integration guidance for adapters, provider/model/auth metadata, sessions, tools, resources, MCP, compaction, attachments, and projection. Use when touching src/main/adapters/pi, agent run orchestration, session projection, provider catalog/auth, Pi resources, MCP adapter behavior, or Pi-native tool events.
---

# Pi Integration

Keep OpenWaggle a product/UI layer over Pi. Pi semantics are the runtime source of truth; OpenWaggle owns typed boundaries, persistence projections, and desktop UX.

## Boundaries

- Pi SDK imports stay under `src/main/adapters/pi/`.
- Application and IPC layers use OpenWaggle-owned ports and DTOs.
- Renderer state uses OpenWaggle UI/read models, not Pi SDK types.
- Future runtime capabilities should enter as Pi-native extensions behind ports, not as a parallel OpenWaggle tool runtime.

## Provider, Model, And Auth

- Source metadata from Pi `AuthStorage`, `ModelRegistry`, and project-scoped session services.
- Treat model identity as `provider/modelId`.
- Keep provider-level runtime availability separate from API-key configured state and OAuth connected state.
- Provider catalog/probe services should avoid loading optional MCP adapter extensions when only metadata/auth probing is needed.
- Do not hardcode provider/model suppression lists for account entitlement failures; surface runtime diagnostics.

## Sessions And Projection

- Pi JSONL is runtime state; SQLite is the product read model.
- Preserve Pi-created session ids before first prompt.
- Treat missing projected Pi entries as stale/cancelled navigation instead of throwing through IPC.
- Persist projected snapshots before telling the renderer that manual compaction is complete.
- Preserve compatible active-run rows across snapshot reprojection.
- Keep transcript/workspace ordering aligned with Pi compaction: summary, kept messages, later messages.

## Transport And Tools

- Preserve Pi-native event semantics end-to-end.
- Render Pi-emitted native tools directly when possible.
- Preserve structured tool results in persistence/UI. Serialize to text only when rebuilding Pi history entries that require text.
- Classify both thrown run failures and completed results with terminal errors.

## Resources And MCP

- Resource precedence is `.openwaggle > .pi > .agents` for skills, extensions, prompts, and themes.
- Inject OpenWaggle project roots into Pi settings before resource loading, then strip implicit roots when persisting Pi settings.
- OpenWaggle config lives at `.openwaggle/settings.json`; Pi settings live under `pi`.
- Scope Pi MCP adapter startup to the active project's generated MCP config and adapter cwd.
- Dispose MCP runtime contexts with session shutdown so server processes do not leak.
- Bundle OpenWaggle-owned Pi extension packages with the app and copy from `app.asar.unpacked` in packaged builds.

## Attachments

- Renderer-facing prepared attachments are metadata/capability records, not authority to read arbitrary paths.
- Preload should extract native paths only from user-granted `File` objects.
- Main should realpath-validate selected files and hydrate binary payloads just in time for Pi sends.
- Do not persist binary data or base64 payloads in renderer/session state.
- User-selected files may live outside the project root; preserve the capability model rather than exposing arbitrary renderer-controlled path reads.

## Verification

Run targeted unit/integration tests for the touched adapter/service plus:

```bash
pnpm check
pnpm typecheck
pnpm lint
```

Use Electron QA for renderer/preload/IPC-visible behavior.
