import Redis from "ioredis";
import { env } from "../config/env";

export function createBullMqRedisConnection(): Redis {
  if (env.redisUrl) {
    return new Redis(env.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }

  return new Redis({
    host: env.redisHost,
    port: env.redisPort,
    maxRetriesPerRequest: null,
  });
}
