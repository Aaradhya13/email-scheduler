import { Job, Worker } from "bullmq";
import { env } from "../config/env";
import { pool } from "../db/postgres";
import { EMAIL_QUEUE_NAME, EmailJobData } from "../queues/emailQueue";
import { createBullMqRedisConnection } from "../queues/redisConnection";
import {
  releaseReservedSendSlot,
  reserveSendSlot,
} from "../services/emailRateLimitService";
import { addEmailJob } from "../services/emailQueueService";
import { sendEmail } from "../services/smtpService";
import {
  getAttachmentAbsolutePath,
  listAttachmentsForEmail,
} from "../services/attachmentService";

type EmailRecord = {
  id: number;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  job_id: string | null;
  hourly_limit: number | null;
  rate_limit_group_id: string | null;
};

type ClaimResult =
  | { type: "claimed"; email: EmailRecord }
  | { type: "missing" }
  | { type: "already_sent"; email: EmailRecord }
  | { type: "skipped"; reason: string; email: EmailRecord };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function claimEmailForProcessing(
  job: Job<EmailJobData>,
): Promise<ClaimResult> {
  const client = await pool.connect();
  const jobId = String(job.id);

  try {
    await client.query("BEGIN");

    const emailResult = await client.query<EmailRecord>(
      `
        SELECT
          id,
          recipient,
          subject,
          body,
          status,
          job_id,
          hourly_limit,
          rate_limit_group_id
        FROM emails
        WHERE id = $1
        FOR UPDATE
      `,
      [job.data.emailId],
    );

    const email = emailResult.rows[0];

    if (!email) {
      await client.query("COMMIT");
      return { type: "missing" };
    }

    if (email.status === "sent") {
      await client.query("COMMIT");
      return { type: "already_sent", email };
    }

    if (email.job_id && email.job_id !== jobId) {
      await client.query("COMMIT");
      return {
        type: "skipped",
        reason: `email belongs to BullMQ job ${email.job_id}, not ${jobId}`,
        email,
      };
    }

    const canClaim =
      email.status === "scheduled" ||
      (email.status === "processing" && email.job_id === jobId);

    if (!canClaim) {
      await client.query("COMMIT");
      return {
        type: "skipped",
        reason: `email status is '${email.status}'`,
        email,
      };
    }

    const updateResult = await client.query<EmailRecord>(
      `
        UPDATE emails
        SET status = 'processing',
            failed_at = NULL,
            last_error = NULL
        WHERE id = $1
      RETURNING
        id,
        recipient,
        subject,
        body,
        status,
        job_id,
        hourly_limit,
        rate_limit_group_id
      `,
      [email.id],
    );

    await client.query("COMMIT");

    return { type: "claimed", email: updateResult.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markEmailScheduledForRateLimit(
  emailId: number,
  currentJobId: string,
  nextJobId: string,
  retryAt: Date,
  reason: string,
): Promise<void> {
  await pool.query(
    `
      UPDATE emails
      SET status = 'scheduled',
          scheduled_at = $1,
          job_id = $2,
          last_error = $3
      WHERE id = $4
        AND job_id = $5
        AND status = 'processing'
    `,
    [
      retryAt,
      nextJobId,
      `Rescheduled because of ${reason}`,
      emailId,
      currentJobId,
    ],
  );
}

async function markEmailSendAttempt(emailId: number, jobId: string): Promise<void> {
  await pool.query(
    `
      UPDATE emails
      SET attempts = attempts + 1,
          last_error = NULL
      WHERE id = $1
        AND job_id = $2
        AND status = 'processing'
    `,
    [emailId, jobId],
  );
}

async function markEmailSent(
  emailId: number,
  jobId: string,
  messageId: string,
  previewUrl: string | false,
): Promise<void> {
  await pool.query(
    `
      UPDATE emails
      SET status = 'sent',
          sent_at = NOW(),
          failed_at = NULL,
          message_id = $1,
          preview_url = $2,
          last_error = NULL
      WHERE id = $3
        AND job_id = $4
        AND status = 'processing'
    `,
    [messageId, previewUrl || null, emailId, jobId],
  );
}

async function markEmailSendFailed(
  job: Job<EmailJobData>,
  error: unknown,
): Promise<void> {
  const attemptsLimit = job.opts.attempts ?? 1;
  const isFinalAttempt = job.attemptsMade + 1 >= attemptsLimit;
  const nextStatus = isFinalAttempt ? "failed" : "scheduled";

  await pool.query(
    `
      UPDATE emails
      SET status = $1,
          failed_at = CASE WHEN $1::varchar = 'failed' THEN NOW() ELSE NULL END,
          last_error = $2
      WHERE id = $3
        AND job_id = $4
        AND status = 'processing'
    `,
    [
      nextStatus,
      getErrorMessage(error),
      job.data.emailId,
      String(job.id),
    ],
  );
}

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const jobId = String(job.id);
  const claim = await claimEmailForProcessing(job);

  if (claim.type === "missing") {
    console.warn(`Email ${job.data.emailId} does not exist. Skipping job ${job.id}.`);
    return;
  }

  if (claim.type === "already_sent") {
    console.log(
      `Email ${claim.email.id} is already sent. Skipping job ${job.id}.`,
    );
    return;
  }

  if (claim.type === "skipped") {
    console.log(
      `Skipping email ${claim.email.id} for job ${job.id}: ${claim.reason}.`,
    );
    return;
  }

  const { email } = claim;

  const batchLimit =
    email.hourly_limit && email.rate_limit_group_id
      ? {
          maxEmailsPerHour: email.hourly_limit,
          groupId: email.rate_limit_group_id,
        }
      : undefined;

  const slot = await reserveSendSlot(batchLimit);

  if (!slot.allowed) {
    const nextJobId = await addEmailJob({
      emailId: email.id,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      scheduledAt: slot.retryAt,
    });

    await markEmailScheduledForRateLimit(
      email.id,
      jobId,
      nextJobId,
      slot.retryAt,
      slot.reason,
    );

    console.log(
      `Rescheduled email ${email.id} for ${slot.retryAt.toISOString()} because of ${slot.reason}.`,
    );
    return;
  }

  console.log(`Sending email ${email.id} for ${email.recipient}`);

  try {
    await markEmailSendAttempt(email.id, jobId);

    const result = await sendEmail({
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      attachments: (await listAttachmentsForEmail(email.id)).map((attachment) => ({
        filename: attachment.filename,
        path: getAttachmentAbsolutePath(attachment),
        contentType: attachment.mime_type,
      })),
    });

    await markEmailSent(
      email.id,
      jobId,
      result.messageId,
      result.previewUrl,
    );

    if (result.previewUrl) {
      console.log(`Ethereal preview URL for email ${email.id}: ${result.previewUrl}`);
    }
  } catch (error) {
    await releaseReservedSendSlot({
      globalRateLimitKey: slot.globalRateLimitKey,
      batchRateLimitKey: slot.batchRateLimitKey,
    });
    await markEmailSendFailed(job, error);
    throw error;
  }
}

const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
  connection: createBullMqRedisConnection(),
  concurrency: env.workerConcurrency,
});

worker.on("completed", (job) => {
  console.log(`Email job ${job.id} completed.`);
});

worker.on("failed", (job, error) => {
  console.error(`Email job ${job?.id ?? "unknown"} failed:`, error);
});

worker.on("error", (error) => {
  console.error("Email worker error:", error);
});

console.log(
  `Email worker started for queue '${EMAIL_QUEUE_NAME}' with concurrency ${env.workerConcurrency}.`,
);

async function shutdown(): Promise<void> {
  await worker.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
