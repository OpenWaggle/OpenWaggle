---
title: "Install extensions"
description: "Install a local extension, review its permissions, and enable or remove it in Settings."
order: 6
section: "Customize"
---

Extensions add features such as settings pages, side panels, commands, and agent tools. They run code, unlike [skills](/docs/extending/skills-system), which provide instructions. Only install extensions from a source you trust.

OpenWaggle has an Extension Manager for local packages. It does not have a public marketplace or remote extension search.

## OpenWaggle extensions

For a project-local package, put the complete extension directory at:

```text
<project>/.openwaggle/extensions/<extension-id>/
```

The directory must contain `openwaggle.extension.json`, and its name must match the manifest's `id`. Keep the package's declared source and built files together. Follow the author's installation instructions rather than copying a single JavaScript file.

Global packages live in OpenWaggle's app-data `extensions/` directory. They can affect every project where they are enabled. Use the approved package workflow for global installation; project-local installation is the narrower choice when you only need an extension in one repository.

## Review and enable a package

1. Open **Settings > Extensions** and click **Refresh**.
2. Find the package and check its path and scope. Read any diagnostics.
3. Review its requested capabilities, network origins, runtime requirements, and any trusted local code. Check that its SDK compatibility range includes your installed app.
4. If it requires a local build, inspect the build command before approving and running it. Build scripts execute local code. Build approval is separate from runtime trust.
5. Choose **Trust**, then **Enable**, then **Reload**.
6. Open the feature the extension adds, such as its settings section or side panel.

Discovery alone does not run the extension. Missing files, an incompatible SDK range, a failed build, or unresolved diagnostics can prevent enablement. Fix the reported problem rather than repeatedly reloading.

## Update, disable, or remove

Trust applies to the package's reviewed contents. Changing its files creates an update that needs approval. Review the changed package, approve any required build and update, then enable and reload it if needed.

Choose **Disable** to stop its contributions without deleting the package. For a global extension, use the project availability controls when you only want to disable it for one project.

Choose **Remove** and confirm to uninstall it. This lets OpenWaggle unregister its contributions before deleting the package. Global removal requires a separate confirmation because it affects other projects. Extension-owned storage is not automatically erased unless a separate data-deletion option is offered.

If an agent helps create, update, or remove a package, review the exact package proposal and scope before approving it. Ask the agent to use OpenWaggle's package workflow, not to delete an installed directory directly.

## Develop your own extension

See [Develop extensions](/docs/extending/openwaggle-extensions) for the manifest, SDK, permissions, and build requirements. For changes to agent tools or runtime behavior, see [Pi extensions](/docs/extending/pi-extensions).
