interface ErrorLike {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
}

// Human-readable error text for toasts; notes when the server says the
// failure is retryable (watchers/queue will keep trying automatically).
export function describeError(error: unknown, fallback = 'Something went wrong'): string {
  const candidate = error as ErrorLike | null;
  const message =
    candidate && typeof candidate.message === 'string' && candidate.message.length > 0
      ? candidate.message
      : fallback;
  const retryable = candidate?.retryable === true;
  return retryable ? `${message} (retryable — will be retried)` : message;
}

export function errorCode(error: unknown): string | null {
  const candidate = error as ErrorLike | null;
  return candidate && typeof candidate.code === 'string' ? candidate.code : null;
}
