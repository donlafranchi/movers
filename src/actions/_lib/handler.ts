// T043 — Handler factory
// Source: development/tickets/done/T043-* § _lib/handler.ts
//
// defineHandler(name, schema, body) creates a NamedActionHandler that:
//   1. Validates input against the Zod schema (raises ValidationError on fail).
//   2. Invokes the body with (ctx, validatedInput).
//
// Transaction management is the body's responsibility — bodies call
// withTransaction explicitly. This keeps the factory simple and lets
// read-only handlers skip the BEGIN/COMMIT overhead.

import type { z, ZodSchema } from 'zod'
import type { ActionContext } from './context'
import { ValidationError } from './errors'

export interface NamedActionHandler<I, O> {
  readonly name: string
  readonly inputSchema: ZodSchema<I>
  (ctx: ActionContext, input: unknown): Promise<O>
}

export function defineHandler<I, O>(
  name: string,
  inputSchema: ZodSchema<I>,
  body: (ctx: ActionContext, input: I) => Promise<O>,
): NamedActionHandler<I, O> {
  const handler = async (ctx: ActionContext, input: unknown): Promise<O> => {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid input for ${name}`,
        parsed.error.flatten(),
      )
    }
    return body(ctx, parsed.data)
  }
  // Attach metadata for the registry + introspection.
  Object.defineProperty(handler, 'name', { value: name, configurable: false })
  Object.defineProperty(handler, 'inputSchema', { value: inputSchema })
  return handler as NamedActionHandler<I, O>
}

// Type helper: pull the input type out of a Zod schema.
export type Input<S> = S extends ZodSchema<infer I> ? I : never
export type _PullInferred<S extends ZodSchema<unknown>> = z.infer<S>
