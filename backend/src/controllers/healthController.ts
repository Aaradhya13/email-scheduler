import { Request, Response } from "express";
import { checkDatabaseConnection } from "../db/postgres";
import { checkRedisConnection } from "../db/redis";

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const [databaseOk, redisOk] = await Promise.all([
    checkDatabaseConnection(),
    checkRedisConnection(),
  ]);

  const healthy = databaseOk && redisOk;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "error",
    services: {
      api: "ok",
      database: databaseOk ? "ok" : "error",
      redis: redisOk ? "ok" : "error",
    },
  });
}
