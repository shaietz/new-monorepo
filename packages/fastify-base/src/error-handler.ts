import { STATUS_CODES } from "node:http";
import fp from "fastify-plugin";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "@fastify/type-provider-zod";
import type { FastifyError, FastifyRequest } from "fastify";

const INTERNAL_MESSAGE = "Internal Server Error";

/** Stops an unlimited 404 being used to enumerate valid URLs. Tighter than the route limiter. */
const NOT_FOUND_MAX = 3;
const NOT_FOUND_WINDOW_MS = 500;

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

/** Enough of the request to reproduce the failure, and nothing that could carry a credential. */
const requestContext = (request: FastifyRequest) => ({
  method: request.method,
  url: request.url,
  query: request.query,
  params: request.params,
});

/**
 * One error shape for every failure. Fastify's default handler sends `error.message` verbatim on a
 * 500, which puts driver text — connection strings included — on the wire.
 *
 * No route may declare a response schema for an error status: the Zod serializer throws on non-Zod
 * schemas rather than falling back, so error bodies must reach the default JSON serializer.
 */
export const errorHandlerPlugin = fp(
  async (fastify) => {
    const maskInternals = fastify.config.NODE_ENV === "production";

    fastify.setNotFoundHandler(
      { preHandler: fastify.rateLimit({ max: NOT_FOUND_MAX, timeWindow: NOT_FOUND_WINDOW_MS }) },
      (request, reply) => {
        request.log.warn({ request: requestContext(request) }, "route not found");
        reply
          .code(404)
          .send(errorBody(404, `Route ${request.method} ${request.url} not found`, request.id));
      },
    );

    // Not `async`: Fastify sends whatever an error handler returns, so this must return nothing.
    // The `FastifyError` argument is explicit because Fastify's own default for it is `unknown`.
    fastify.setErrorHandler<FastifyError>((error, request, reply) => {
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
        // A reply that violates its own schema is a bug here, and never safe to echo back.
        request.log.error(
          { err: error, request: requestContext(request) },
          "response does not match its schema",
        );
        reply.code(500).send(errorBody(500, INTERNAL_MESSAGE, request.id));
        return;
      }

      const statusCode = error.statusCode ?? 500;

      if (statusCode >= 500) {
        request.log.error({ err: error, request: requestContext(request) }, "request failed");
        reply
          .code(statusCode)
          .send(
            errorBody(statusCode, maskInternals ? INTERNAL_MESSAGE : error.message, request.id),
          );
        return;
      }

      // 4xx messages are deliberate and client-facing — sensible's `httpErrors`, rate-limit's 429.
      reply.code(statusCode).send(errorBody(statusCode, error.message, request.id));
    });
  },
  { name: "error-handler", dependencies: ["@fastify/rate-limit"] },
);
