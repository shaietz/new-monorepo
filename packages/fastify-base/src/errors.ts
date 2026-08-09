import { STATUS_CODES } from "node:http";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "@fastify/type-provider-zod";
import type { FastifyError, FastifyInstance } from "fastify";

import type { BaseConfig } from "./env.ts";

const INTERNAL_MESSAGE = "Internal Server Error";

interface ErrorBody {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  /** Ties a user-reported failure to a log line. Without it, a 500 is untraceable. */
  readonly requestId: string;
}

function errorBody(statusCode: number, message: string, requestId: string): ErrorBody {
  return {
    statusCode,
    error: STATUS_CODES[statusCode] ?? INTERNAL_MESSAGE,
    message,
    requestId,
  };
}

/**
 * One error shape for every failure a service can produce.
 *
 * Fastify's default handler sends `error.message` verbatim on a 500, so an unhandled driver error
 * puts its own text — connection strings included — on the wire. Nothing official replaces this;
 * Fastify's position is that error policy belongs to the application.
 *
 * Note that no route here declares a response schema for an error status. The Zod serializer throws
 * on non-Zod schemas rather than falling back, so an error body must reach the default JSON
 * serializer instead.
 */
export function registerErrorHandlers(server: FastifyInstance, config: BaseConfig): void {
  const maskInternals = config.NODE_ENV === "production";

  server.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(errorBody(404, `Route ${request.method} ${request.url} not found`, request.id));
  });

  // Not `async`: Fastify sends whatever an error handler returns, so this must return nothing.
  // The `FastifyError` argument is explicit because Fastify's own default for it is `unknown`.
  server.setErrorHandler<FastifyError>((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      reply.code(400).send({
        ...errorBody(400, "Request does not match the expected schema", request.id),
        details: error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message ?? "invalid",
        })),
      });
      return;
    }

    if (isResponseSerializationError(error)) {
      // The handler returned something its own response schema rejects. That is a bug in the
      // service, and the offending shape is never safe to echo back.
      request.log.error({ err: error }, "response does not match its schema");
      reply.code(500).send(errorBody(500, INTERNAL_MESSAGE, request.id));
      return;
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
      reply
        .code(statusCode)
        .send(errorBody(statusCode, maskInternals ? INTERNAL_MESSAGE : error.message, request.id));
      return;
    }

    // 4xx messages are deliberate and client-facing — sensible's `httpErrors`, rate-limit's 429.
    reply.code(statusCode).send(errorBody(statusCode, error.message, request.id));
  });
}
