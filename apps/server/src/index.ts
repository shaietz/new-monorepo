import { startService } from "@repo/fastify-base";
import { buildServer, config } from "./app.ts";

await startService(await buildServer(), config);
