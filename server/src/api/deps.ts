import type { Request, Response, NextFunction } from "express";
import type { z } from "zod/v4";

/** Shared guards for the HTTP layer. Nothing domain-specific belongs here. */

export function validate<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const detail = result.error.issues
    .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
    .join("; ");

  throw Object.assign(new Error(detail), { status: 400 });
}

export function notFound(res: Response, what: string): void {
  res.status(404).json({ error: `${what} not found` });
}

/** Async handlers reject silently in Express unless their errors are forwarded. */
export function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error & { status?: number },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err.status ?? 500;
  console.error(`${req.method} ${req.path} — ${err.stack ?? err.message}`);

  // Only client errors get a message. A 500 can carry connection strings and
  // provider payloads, so it stays in the log.
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
  });
}
