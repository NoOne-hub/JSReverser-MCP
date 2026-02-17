export interface ErrorResponse {
  code: string;
  type: string;
  message: string;
  context?: Record<string, unknown>;
}

export const ErrorCodes = {
  TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  BROWSER_ERROR: 'BROWSER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export function formatError(
  error: unknown,
  code: string = ErrorCodes.INTERNAL_ERROR,
  context?: Record<string, unknown>,
): ErrorResponse {
  if (error instanceof Error) {
    return {
      code,
      type: error.name || 'Error',
      message: error.message,
      context,
    };
  }

  return {
    code,
    type: 'UnknownError',
    message: String(error),
    context,
  };
}
