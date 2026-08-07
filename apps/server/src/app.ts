import { randomUUID } from "node:crypto";
import fastify from "fastify";
import { basePlugin, loadConfig, loggerOptions, type ZodTypeProvider } from "@repo/fastify-base";
import { CreateUserSchema, UserSchema } from "@repo/schemas";

export const config = loadConfig();

export async function buildServer() {
  const server = fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.BODY_LIMIT,
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      if (typeof header !== "string") return randomUUID();
      const first = header.split(",", 1).join("").trim();
      return first === "" ? randomUUID() : first;
    },
  });

  await server.register(basePlugin, { config });

  server.get("/ping", async () => {
    return "pong\n";
  });

  server.withTypeProvider<ZodTypeProvider>().post(
    "/users",
    {
      schema: {
        body: CreateUserSchema,
        response: { 201: UserSchema },
      },
    },
    async (req, reply) => {
      const user = { id: randomUUID(), ...req.body };
      return reply.code(201).send(user);
    },
  );

  return server;
}
