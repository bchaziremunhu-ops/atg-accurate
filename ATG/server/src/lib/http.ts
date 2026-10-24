import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type output } from 'zod';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): output<S> {
  return schema.parse(body) as output<S>;
}

export function validate<S extends ZodTypeAny>(schema: S, body: unknown): output<S> {
  try {
    return schema.parse(body) as output<S>;
  } catch (e) {
    throw e instanceof ZodError ? e : e;
  }
}
