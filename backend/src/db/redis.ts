import Redis from "ioredis";
import { env } from "../config/env";

export const redis = env.redisUrl
  ? new Redis(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
  : new Redis({
      host: env.redisHost,
      port: env.redisPort,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const response = await redis.ping();
    return response === "PONG";
  } catch (error) {
    console.error("Redis health check failed:", error);
    return false;
  }
}
