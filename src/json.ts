export interface ParseJsonTextOptions {
  readonly provider: string;
  readonly maxPreviewChars?: number;
  readonly formatError?: (args: {
    readonly provider: string;
    readonly preview: string;
    readonly parseError: Error;
  }) => string;
}

export function parseJsonText(text: string, options: ParseJsonTextOptions): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = asError(error);
    const preview = previewText(text, options.maxPreviewChars ?? 180);
    const message = options.formatError
      ? options.formatError({ provider: options.provider, preview, parseError })
      : `${options.provider} response is not valid JSON: ${parseError.message}; content=${preview}`;
    throw new Error(message, { cause: parseError });
  }
}

export function previewText(value: string, maxChars = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }

  if (maxChars <= 3) {
    return compact.slice(0, Math.max(maxChars, 0));
  }

  return `${compact.slice(0, maxChars - 3)}...`;
}

export function previewJson(value: unknown, maxChars = 180): string {
  try {
    return previewText(JSON.stringify(value), maxChars);
  } catch {
    return "<unserializable-response>";
  }
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
