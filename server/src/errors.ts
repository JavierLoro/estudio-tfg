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
export const fileInUse = () => new HttpError(423, 'El archivo está en uso por otro programa; ciérralo y vuelve a intentarlo');
