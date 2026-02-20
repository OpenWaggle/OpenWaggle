import type { StandardSchemaV1 } from "@standard-schema/spec";

/** A normalized contract validation issue. */
export interface ContractIssue {
  readonly message: string;
  readonly path: string;
}

/**
 * Result returned by {@link validateContract}.
 *
 * @typeParam TOutput - The validated output shape produced by the contract.
 */
export interface ContractValidationResult<TOutput> {
  readonly ok: boolean;
  readonly value?: TOutput;
  readonly issues?: readonly ContractIssue[];
}

/**
 * Validates a runtime value against a Standard Schema contract.
 *
 * @remarks
 * This function normalizes provider-specific issue paths into dotted strings
 * so traces and diagnostics can render stable failure locations.
 */
export async function validateContract<TOutput>(
  contract: StandardSchemaV1<unknown, TOutput>,
  value: unknown,
): Promise<ContractValidationResult<TOutput>> {
  const result = await contract["~standard"].validate(value);
  if ("issues" in result && result.issues && result.issues.length > 0) {
    return {
      ok: false,
      issues: result.issues.map((issue) => ({
        message: issue.message,
        path: formatPath(issue.path),
      })),
    };
  }

  if ("value" in result) {
    return { ok: true, value: result.value };
  }

  return {
    ok: false,
    issues: [{ message: "contract validation failed", path: "<root>" }],
  };
}

function formatPath(
  path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined,
): string {
  if (!path || path.length === 0) {
    return "<root>";
  }

  return path
    .map((segment) => {
      if (typeof segment === "object" && segment !== null && "key" in segment) {
        return String(segment.key);
      }
      return String(segment);
    })
    .join(".");
}
