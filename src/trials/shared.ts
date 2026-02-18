export function normalizeRequiredString(value: string, field: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function normalizeString(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeStringArray(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}
