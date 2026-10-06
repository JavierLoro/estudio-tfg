export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const notFound = (m = 'No encontrado') => new HttpError(404, m);
