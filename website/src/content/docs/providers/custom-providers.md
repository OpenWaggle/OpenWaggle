---
title: "Custom Providers"
description: "How custom Pi provider configuration appears in OpenWaggle."
order: 4
section: "Providers"
---

OpenWaggle's provider list is generated from Pi model metadata. If Pi loads custom provider configuration for a project, OpenWaggle can display those providers and models in Settings and the composer model selector.

Pi references:

- [Custom models](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- [Custom providers and `pi.registerProvider()`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)

## Project Scope

Provider/model listing accepts the active project path and asks Pi to create project-scoped runtime services. This lets Pi include models that only exist for that project.

Provider key tests and standard agent runs also use the active project path when constructing Pi runtime services.

## Model Identity

Custom and built-in models use the same provider-qualified shape:

```text
provider/modelId
```

This matters because the same hosted model can appear through multiple providers. For example, a GPT model through OpenAI and the same GPT model through another gateway are distinct runtime choices.
