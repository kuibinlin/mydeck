// Domain errors.
//
// Services throw these instead of returning Response objects, so the same
// function can serve an HTTP route, an agent tool, or a test.
//
// `status` is what the HTTP layer maps to a response code. Anything without a
// status is an unexpected failure and becomes a 500.

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export const badRequest = (message) => new AppError(400, message);
export const unauthorized = (message = "Not authenticated") =>
  new AppError(401, message);
export const forbidden = (message = "Forbidden") => new AppError(403, message);
export const notFound = (message = "Not found") => new AppError(404, message);
export const tooManyRequests = (message) => new AppError(429, message);
export const badGateway = (message) => new AppError(502, message);
