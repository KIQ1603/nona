import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../errors/app-error';

/** Validates untrusted input at the boundary; failures become VALIDATION_FAILED with field issues. */
export function parseInput<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw AppError.validation({
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}
