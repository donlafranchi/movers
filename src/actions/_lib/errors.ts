// T043 — Action layer errors
// Source: development/tickets/done/T043-* § _lib/errors.ts
//
// ActionError taxonomy. The handler factory wraps Zod failures in
// ValidationError. Other handlers raise the appropriate subclass when they
// detect the named condition. The route layer maps these to HTTP statuses.

export type ActionErrorCode =
  | 'validation_error'
  | 'authorization_error'
  | 'conflict_error'
  | 'not_found_error'
  | 'transient_error'

export class ActionError extends Error {
  constructor(
    public readonly code: ActionErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ActionError'
  }
}

export class ValidationError extends ActionError {
  constructor(message: string, details?: unknown) {
    super('validation_error', message, details)
    this.name = 'ValidationError'
  }
}

export class AuthorizationError extends ActionError {
  constructor(message: string, details?: unknown) {
    super('authorization_error', message, details)
    this.name = 'AuthorizationError'
  }
}

export class ConflictError extends ActionError {
  constructor(message: string, details?: unknown) {
    super('conflict_error', message, details)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends ActionError {
  constructor(message: string, details?: unknown) {
    super('not_found_error', message, details)
    this.name = 'NotFoundError'
  }
}

export class TransientError extends ActionError {
  constructor(message: string, details?: unknown) {
    super('transient_error', message, details)
    this.name = 'TransientError'
  }
}

// Map an ActionError to an HTTP status code. Route handlers use this.
export const ACTION_ERROR_HTTP_STATUS: Record<ActionErrorCode, number> = {
  validation_error: 400,
  authorization_error: 403,
  conflict_error: 409,
  not_found_error: 404,
  transient_error: 503,
}
