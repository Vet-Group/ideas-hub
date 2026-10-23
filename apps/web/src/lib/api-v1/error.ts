export type ApiErrorCode = 'invalid_request' | 'invalid_cursor' | 'unauthorized' | 'insufficient_scope' | 'not_found' | 'rate_limited' | 'internal';

/** An error the client sees: the contract's status, code and an English developer message. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 429 | 500,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
