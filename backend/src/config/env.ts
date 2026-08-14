import dotenv from "dotenv";

dotenv.config();

const etherealPort = process.env.ETHEREAL_PORT
  ? Number(process.env.ETHEREAL_PORT)
  : 587;

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: process.env.PORT ?? "5000",
  databaseUrl: process.env.DATABASE_URL,
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  sessionSecret:
    process.env.SESSION_SECRET ?? "development-session-secret-change-me",
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  redisUrl: process.env.REDIS_URL,
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  minEmailDelayMs: Number(process.env.MIN_EMAIL_DELAY_MS ?? 2000),
  maxEmailsPerHour: Number(process.env.MAX_EMAILS_PER_HOUR ?? 200),
  attachmentUploadDir:
    process.env.ATTACHMENT_UPLOAD_DIR ?? "uploads/email-attachments",
  maxAttachmentSizeBytes: Number(
    process.env.MAX_ATTACHMENT_SIZE_BYTES ?? 5 * 1024 * 1024,
  ),
  etherealHost: process.env.ETHEREAL_HOST,
  etherealPort,
  etherealUser: process.env.ETHEREAL_USER,
  etherealPassword: process.env.ETHEREAL_PASSWORD,
  etherealFrom: process.env.ETHEREAL_FROM ?? "Outbox Labs <no-reply@outbox.test>",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
};
