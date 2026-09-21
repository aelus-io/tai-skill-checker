export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} was not found`, 404)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super('FORBIDDEN', message, 403)
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 409)
  }
}

export class ConfigurationError extends AppError {
  constructor(provider: string) {
    super('PROVIDER_NOT_CONFIGURED', `${provider} is not configured`, 503)
  }
}
