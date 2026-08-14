import { redis } from "../db/redis";
import { env } from "../config/env";

const MIN_DELAY_KEY = "email-send-coordination:last-send-at-ms";
const RATE_LIMIT_PREFIX = "email-rate-limit";
const GLOBAL_RATE_LIMIT_PREFIX = `${RATE_LIMIT_PREFIX}:global`;
const BATCH_RATE_LIMIT_PREFIX = `${RATE_LIMIT_PREFIX}:batch`;

const RESERVE_SEND_SLOT_SCRIPT = `
  local nowMs = tonumber(ARGV[1])
  local minDelayMs = tonumber(ARGV[2])
  local globalMaxPerHour = tonumber(ARGV[3])
  local nextHourMs = tonumber(ARGV[4])
  local expireSeconds = tonumber(ARGV[5])
  local coordinationExpireMs = tonumber(ARGV[6])
  local batchMaxPerHour = tonumber(ARGV[7])

  local lastSendAt = tonumber(redis.call("GET", KEYS[1]) or "0")
  local nextDelayAt = lastSendAt + minDelayMs
  local globalCount = tonumber(redis.call("GET", KEYS[2]) or "0")
  local batchCount = 0

  if globalMaxPerHour > 0 and globalCount >= globalMaxPerHour then
    local waitUntil = nextHourMs
    if minDelayMs > 0 and nextDelayAt > waitUntil then
      waitUntil = nextDelayAt
    end
    return {0, waitUntil, "global_hourly_rate_limit", globalCount, batchCount}
  end

  if batchMaxPerHour > 0 then
    batchCount = tonumber(redis.call("GET", KEYS[3]) or "0")
    if batchCount >= batchMaxPerHour then
      local waitUntil = nextHourMs
      if minDelayMs > 0 and nextDelayAt > waitUntil then
        waitUntil = nextDelayAt
      end
      return {0, waitUntil, "batch_hourly_rate_limit", globalCount, batchCount}
    end
  end

  if minDelayMs > 0 and nowMs < nextDelayAt then
    return {0, nextDelayAt, "minimum_send_delay", globalCount, batchCount}
  end

  if minDelayMs > 0 then
    redis.call("SET", KEYS[1], nowMs, "PX", coordinationExpireMs)
  end

  local newGlobalCount = redis.call("INCR", KEYS[2])
  redis.call("EXPIRE", KEYS[2], expireSeconds)

  if batchMaxPerHour > 0 then
    batchCount = redis.call("INCR", KEYS[3])
    redis.call("EXPIRE", KEYS[3], expireSeconds)
  end

  return {1, nowMs, "allowed", newGlobalCount, batchCount}
`;

export type SendSlotReservation =
  | {
      allowed: true;
      globalRateLimitKey: string;
      batchRateLimitKey: string | null;
      globalCount: number;
      batchCount: number;
    }
  | {
      allowed: false;
      retryAt: Date;
      delayMs: number;
      reason:
        | "global_hourly_rate_limit"
        | "batch_hourly_rate_limit"
        | "minimum_send_delay";
      globalRateLimitKey: string;
      batchRateLimitKey: string | null;
      globalCount: number;
      batchCount: number;
    };

function getLocalHourSuffix(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}-${hour}`;
}

function getNextLocalHourStart(now: Date): Date {
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);

  return nextHour;
}

export async function reserveSendSlot(
  batchLimit?: {
    maxEmailsPerHour: number;
    groupId: string;
  },
): Promise<SendSlotReservation> {
  const now = new Date();
  const nextHour = getNextLocalHourStart(now);
  const hourSuffix = getLocalHourSuffix(now);
  const globalRateLimitKey = `${GLOBAL_RATE_LIMIT_PREFIX}:${hourSuffix}`;
  const batchRateLimitKey = batchLimit
    ? `${BATCH_RATE_LIMIT_PREFIX}:${batchLimit.groupId}:${hourSuffix}`
    : `${BATCH_RATE_LIMIT_PREFIX}:unused:${hourSuffix}`;
  const expireSeconds = Math.ceil((nextHour.getTime() - now.getTime()) / 1000) + 3600;
  const coordinationExpireMs = Math.max(env.minEmailDelayMs * 10, 60_000);

  const result = (await redis.eval(
    RESERVE_SEND_SLOT_SCRIPT,
    3,
    MIN_DELAY_KEY,
    globalRateLimitKey,
    batchRateLimitKey,
    now.getTime(),
    env.minEmailDelayMs,
    env.maxEmailsPerHour,
    nextHour.getTime(),
    expireSeconds,
    coordinationExpireMs,
    batchLimit?.maxEmailsPerHour ?? 0,
  )) as [number, number, string, number, number];

  const [allowed, timestampMs, reason, globalCount, batchCount] = result;

  if (allowed === 1) {
    return {
      allowed: true,
      globalRateLimitKey,
      batchRateLimitKey: batchLimit ? batchRateLimitKey : null,
      globalCount,
      batchCount,
    };
  }

  const retryAt = new Date(timestampMs);

  return {
    allowed: false,
    retryAt,
      delayMs: Math.max(timestampMs - Date.now(), 0),
      reason: reason as
        | "global_hourly_rate_limit"
        | "batch_hourly_rate_limit"
        | "minimum_send_delay",
      globalRateLimitKey,
      batchRateLimitKey: batchLimit ? batchRateLimitKey : null,
      globalCount,
      batchCount,
    };
}

export async function releaseReservedSendSlot(input: {
  globalRateLimitKey: string;
  batchRateLimitKey: string | null;
}): Promise<void> {
  await redis.eval(
    `
      local released = 0
      for index = 1, #KEYS do
        local key = KEYS[index]
        if key and key ~= "" then
          local current = tonumber(redis.call("GET", key) or "0")
          if current > 0 then
            redis.call("DECR", key)
            released = released + 1
          end
        end
      end
      return released
    `,
    input.batchRateLimitKey ? 2 : 1,
    input.globalRateLimitKey,
    ...(input.batchRateLimitKey ? [input.batchRateLimitKey] : []),
  );
}

export const emailRateLimitKeys = {
  minDelayKey: MIN_DELAY_KEY,
  hourlyPrefix: RATE_LIMIT_PREFIX,
  globalHourlyPrefix: GLOBAL_RATE_LIMIT_PREFIX,
  batchHourlyPrefix: BATCH_RATE_LIMIT_PREFIX,
};
