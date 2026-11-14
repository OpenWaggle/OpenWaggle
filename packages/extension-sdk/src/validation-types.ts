/**
 * One reason a value failed validation. `path` is the dotted field path the host reports in its
 * diagnostics, such as `contributions.sidePanels.0.icon`, with array items by index, and
 * `(root)` for the value itself. It is empty when reading the value threw, for example from a
 * throwing getter or a Proxy.
 */
export interface ExtensionValidationIssue {
  readonly path: string
  readonly message: string
}

/** What a `validate*` helper returns: the valid value, or every issue it found. */
export type ExtensionValidationResult<TValue> =
  | { readonly success: true; readonly value: TValue }
  | { readonly success: false; readonly issues: readonly ExtensionValidationIssue[] }
