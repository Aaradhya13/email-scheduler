import Redis from "ioredis";
import { env } from "../config/env";

export function createBullMqRedisConnection(): Redis {
  return new Redis({
    host: env.redisHost,
    port: env.redisPort,
    maxRetriesPerRequest: null,
  });
}
