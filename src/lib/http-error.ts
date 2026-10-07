export type ErrorDetails = Record<string, string[]>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: ErrorDetails) =>
  new HttpError(400, message, details);
export const unauthorized = (message = "Authentication required") => new HttpError(401, message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new HttpError(403, message);
export const notFound = (resource = "Resource") => new HttpError(404, `${resource} not found`);
export const conflict = (message: string) => new HttpError(409, message);
export const tooManyRequests = (message: string) => new HttpError(429, message);
