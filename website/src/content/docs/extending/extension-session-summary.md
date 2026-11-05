---
title: "Add to the Session Summary"
description: "Add an extension section to the floating Session Summary, and publish sources and outputs for a session."
order: 8
section: "Developer docs"
kind: "guide"
---

An extension can add its own section to the floating [Session Summary](/docs/using-openwaggle/session-summary) of the session you have open, and it can publish links and images to that session's sources and outputs. Use a Session Summary section for short facts about the session, such as a check's state, a count, or a link to the extension's side panel. This guide assumes you have a working extension; start with [Develop extensions](/docs/extending/openwaggle-extensions) if you do not. Every field and limit is in the [manifest reference](/docs/extending/extension-manifest#session-summary-sections).

## Add a section

Sections are declarative. You list the rows in the manifest, and OpenWaggle draws the title, state, expand and collapse control, rows, resource links, and actions. That keeps the layout, keyboard behavior, and failure handling the same as OpenWaggle's own sections.

```json
{
  "sessionSummarySections": [
    {
      "id": "example.session-summary",
      "title": "Example Session Status",
      "placement": "details",
      "rows": [
        { "id": "status", "label": "Status", "value": "Ready" },
        {
          "id": "open-details",
          "label": "Open details",
          "action": { "family": "sidePanels", "contributionId": "example.panel" }
        }
      ]
    }
  ]
}
```

The Summary is there when the open session has messages, Hive relationships, or workspace activity such as managed actions or workspace setup. It floats over the chat and never takes width from it. Your section appears in the open Summary when the package and the session are eligible, and it goes away with the Summary while the right sidebar is open.

A section must not show authorization controls, guess at another session, or replace OpenWaggle's own Environment, Hive, Outputs, or Sources sections.

## Choose where the section goes

Set `placement` by how the information relates to the session:

- `context` sections come after Environment, Actions, workspace setup, and pull or merge request details, and before Hive.
- `coordination` sections come after Hive.
- `details` sections, the default, come after Sources.

OpenWaggle sets the order within each placement. Extensions cannot move or replace its own sections.

## Show what the extension is doing

Set `state` to `ready`, `loading`, `live`, or `failure`. `loading` and `live` can carry a message, and `failure` must carry one.

OpenWaggle hides a `ready` section that has no rows. A `loading`, `live`, or `failure` section stays visible even without rows, so you can see what the extension is doing.

`disclosure` sets whether the section starts expanded, whether it can collapse, and an optional `autoCollapseAfterMs` between 1,000 and 300,000 milliseconds. OpenWaggle remembers whether a section is expanded for each session and each installed version of the package content. Open dialogs and pending actions reset when you open another session. One extension failing does not affect the rest of the Summary.

## Add rows and actions

A row can show a `value`, a `badge`, a `count`, or a resource (`resourceId`). It can also run an `action` that opens a command, dialog, or side panel from the same package. A row can point to a resource or to an action, not both, so use two rows when you need both.

An action names a `commands`, `dialogs`, or `sidePanels` contribution of the same package, by its family and id. A command also needs a capability and method it can run. If the target is missing, has the wrong family, is not eligible, or is out of scope, OpenWaggle rejects the section and reports a contribution diagnostic, instead of leaving a row that does nothing.

Commands run through the SDK in the narrowest scope the package declares: session first, then project, then app. A dialog opened from a row gets `context.sessionId`, and this `context.surface.payload`:

```json
{
  "surface": "session-summary",
  "sessionId": "the-opened-session-id",
  "projectPaths": ["/path/to/project"],
  "messageCount": 12
}
```

Treat these values as information about where the dialog opened, not as permission to act. OpenWaggle still checks the contribution, package, project, session, capability, and method on every call. A side panel opened from a row is matched to the open session again when the right sidebar mounts it.

## Publish sources and outputs

A contribution that runs code can publish links and images to the open session's sources and outputs, through `context.sdk.openWaggle.resources`. They stay with the session after the app restarts. Declare the `openwaggle.resources` capability on the package, and on the contribution that publishes:

```json
{
  "capabilities": [
    {
      "id": "openwaggle.resources",
      "methods": ["publish-resource", "list-resources"],
      "scopes": ["session"]
    }
  ],
  "contributions": {
    "sidePanels": [
      {
        "id": "example.results",
        "title": "Example Results",
        "runtime": "federated-module",
        "execution": "host-renderer",
        "entry": "modules/results.js",
        "capability": "openwaggle.resources",
        "methods": ["publish-resource", "list-resources"]
      }
    ],
    "sessionSummarySections": [
      {
        "id": "example.session-summary",
        "title": "Example Results",
        "placement": "details",
        "disclosure": { "defaultExpanded": true },
        "state": { "status": "live", "message": "Watching checks" },
        "rows": [
          {
            "id": "open-results",
            "label": "Open results",
            "action": { "family": "sidePanels", "contributionId": "example.results" }
          }
        ]
      }
    ]
  }
}
```

Take the session id and project path from the mount context OpenWaggle gives you. Never take either from input your extension controls:

```ts
import type { OpenWaggleExtensionMountContext } from '@openwaggle/extension-sdk'

export async function publishCoverage(context: OpenWaggleExtensionMountContext) {
  const projectPath = context.projectPaths[0]
  if (!context.sessionId || !projectPath) return

  const scope = {
    kind: 'session' as const,
    projectPath,
    sessionId: context.sessionId,
  }
  const published = await context.sdk.openWaggle.resources.publish(scope, {
    key: 'coverage-report',
    kind: 'link',
    title: 'Coverage report',
    role: 'output',
    locator: 'https://reports.example.com/coverage',
  })
  if (!published.ok) return published

  return context.sdk.openWaggle.resources.list(scope)
}
```

Give each resource a stable `key` within your contribution. Publishing the same key, kind, role, and locator again changes nothing, so it is safe to repeat. This version accepts only `image` and `link` resources with HTTPS locators that carry no credentials, in the `source` or `output` role.

`list(scope, { limit, cursor })` takes a `limit` from 1 to 100 and returns one page:

- `value.resources` holds display details only.
- `value.total` is the exact number of resources in the session.
- `value.nextCursor` gets the next page, in the same order.

The original locators, the stored file paths, the publishing history, and the internal keys stay private to OpenWaggle. Both methods only reach the project and session of the mounted contribution, so changing the scope you pass cannot expose another session, open or archived.

## Link a row to a resource

Put the resource id that `publish` or `list` returned in a row's `resourceId`. OpenWaggle opens an image you can view in the session's gallery, and any other resource in its Sources or Outputs view. An id from another session, a deleted resource, or an id you made up stays unavailable. Do not keep resource ids across sessions. List or publish again, and replace the section.

## Update a section while the extension runs

For information that changes, register a `sessionSummarySections` contribution at run time, in session scope (see [Add contributions while the extension runs](/docs/extending/openwaggle-extensions#add-contributions-while-the-extension-runs)). Registering the same family, contribution id, and scope again replaces the previous value, so a worker count or a check's state can change without restarting OpenWaggle. Unregister it during cleanup, once the information no longer applies.

OpenWaggle keeps a session-scoped registration on the project and session that registered it, even if the contribution leaves out `target`, and naming another target fails. Branch-scoped registration is not supported yet.

## Let the user load images

Publishing an image does not download it. Neither does listing it, or the Summary coming into view. OpenWaggle fetches the image over HTTPS only when you open it. If the download or the stored copy fails, OpenWaggle shows a retry option in its own resource view. To retry from your extension, publish the same key and locator again rather than a new resource.
