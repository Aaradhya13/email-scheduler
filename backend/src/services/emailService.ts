import { pool } from "../db/postgres";
import { addEmailJob } from "./emailQueueService";
import {
  EmailAttachment,
  insertEmailAttachments,
  listAttachmentsForEmail,
  StoredAttachmentInput,
} from "./attachmentService";

export type ScheduledEmail = {
  id: number;
  user_id: number | null;
  recipient: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  status: string;
  attempts: number;
  sent_at: Date | null;
  failed_at: Date | null;
  job_id: string | null;
  message_id: string | null;
  preview_url: string | null;
  last_error: string | null;
  hourly_limit: number | null;
  rate_limit_group_id: string | null;
  attachments?: EmailAttachment[];
  created_at: Date;
  updated_at: Date;
};

type CreateTestEmailInput = {
  recipient: string;
  subject: string;
  body: string;
  delaySeconds: number;
};

type CreateUserEmailInput = {
  userId: number;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  hourlyLimit: number | null;
  rateLimitGroupId: string | null;
  attachments?: StoredAttachmentInput[];
};

type CreateBulkTestEmailsInput = {
  recipientPrefix: string;
  subject: string;
  body: string;
  delaySeconds: number;
  count: number;
};

export async function createTestScheduledEmail(
  input: CreateTestEmailInput,
): Promise<ScheduledEmail> {
  const scheduledAt = new Date(Date.now() + input.delaySeconds * 1000);

  const insertResult = await pool.query<ScheduledEmail>(
    `
      INSERT INTO emails (recipient, subject, body, scheduled_at, status)
      VALUES ($1, $2, $3, $4, 'scheduled')
      RETURNING *
    `,
    [input.recipient, input.subject, input.body, scheduledAt],
  );

  const email = insertResult.rows[0];

  try {
    const jobId = await addEmailJob({
      emailId: email.id,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      scheduledAt,
    });

    const updateResult = await pool.query<ScheduledEmail>(
      `
        UPDATE emails
        SET job_id = $1
        WHERE id = $2
        RETURNING *
      `,
      [jobId, email.id],
    );

    return updateResult.rows[0];
  } catch (error) {
    await pool.query(
      `
        UPDATE emails
        SET status = 'failed', failed_at = NOW()
        WHERE id = $1
      `,
      [email.id],
    );

    throw error;
  }
}

async function attachEmailAttachments(
  emails: ScheduledEmail[],
): Promise<ScheduledEmail[]> {
  return Promise.all(
    emails.map(async (email) => ({
      ...email,
      attachments: await listAttachmentsForEmail(email.id),
    })),
  );
}

export async function createScheduledEmailForUser(
  input: CreateUserEmailInput,
): Promise<ScheduledEmail> {
  const insertResult = await pool.query<ScheduledEmail>(
    `
      INSERT INTO emails (
        user_id,
        recipient,
        subject,
        body,
        scheduled_at,
        status,
        hourly_limit,
        rate_limit_group_id
      )
      VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7)
      RETURNING *
    `,
    [
      input.userId,
      input.recipient,
      input.subject,
      input.body,
      input.scheduledAt,
      input.hourlyLimit,
      input.rateLimitGroupId,
    ],
  );

  const email = insertResult.rows[0];

  if (input.attachments?.length) {
    await insertEmailAttachments(email.id, input.attachments);
  }

  try {
    const jobId = await addEmailJob({
      emailId: email.id,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      scheduledAt: input.scheduledAt,
    });

    const updateResult = await pool.query<ScheduledEmail>(
      `
        UPDATE emails
        SET job_id = $1
        WHERE id = $2
        RETURNING *
      `,
      [jobId, email.id],
    );

    return {
      ...updateResult.rows[0],
      attachments: await listAttachmentsForEmail(email.id),
    };
  } catch (error) {
    await pool.query(
      `
        UPDATE emails
        SET status = 'failed', failed_at = NOW(), last_error = $1
        WHERE id = $2
      `,
      [error instanceof Error ? error.message : String(error), email.id],
    );

    throw error;
  }
}

export async function createBulkTestScheduledEmails(
  input: CreateBulkTestEmailsInput,
): Promise<ScheduledEmail[]> {
  const emails: ScheduledEmail[] = [];

  for (let index = 0; index < input.count; index += 1) {
    const email = await createTestScheduledEmail({
      recipient: `${input.recipientPrefix}+${index + 1}@example.com`,
      subject: `${input.subject} ${index + 1}`,
      body: input.body,
      delaySeconds: input.delaySeconds,
    });

    emails.push(email);
  }

  return emails;
}

export async function listEmails(): Promise<ScheduledEmail[]> {
  const result = await pool.query<ScheduledEmail>(`
    SELECT
      id,
      user_id,
      recipient,
      subject,
      body,
      scheduled_at,
      status,
      attempts,
      sent_at,
      failed_at,
      job_id,
      message_id,
      preview_url,
      last_error,
      hourly_limit,
      rate_limit_group_id,
      created_at,
      updated_at
    FROM emails
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return attachEmailAttachments(result.rows);
}

export async function listScheduledEmailsForUser(
  userId: number,
): Promise<ScheduledEmail[]> {
  const result = await pool.query<ScheduledEmail>(
    `
      SELECT
        id,
        user_id,
        recipient,
        subject,
        body,
        scheduled_at,
        status,
        attempts,
        sent_at,
        failed_at,
        job_id,
        message_id,
        preview_url,
        last_error,
        hourly_limit,
        rate_limit_group_id,
        created_at,
        updated_at
      FROM emails
      WHERE user_id = $1
        AND status = 'scheduled'
      ORDER BY scheduled_at ASC
    `,
    [userId],
  );

  return attachEmailAttachments(result.rows);
}

export async function listSentEmailsForUser(userId: number): Promise<ScheduledEmail[]> {
  const result = await pool.query<ScheduledEmail>(
    `
      SELECT
        id,
        user_id,
        recipient,
        subject,
        body,
        scheduled_at,
        status,
        attempts,
        sent_at,
        failed_at,
        job_id,
        message_id,
        preview_url,
        last_error,
        hourly_limit,
        rate_limit_group_id,
        created_at,
        updated_at
      FROM emails
      WHERE user_id = $1
        AND status = 'sent'
      ORDER BY sent_at DESC NULLS LAST, created_at DESC
    `,
    [userId],
  );

  return attachEmailAttachments(result.rows);
}

export async function findEmailForUser(
  userId: number,
  emailId: number,
): Promise<ScheduledEmail | null> {
  const result = await pool.query<ScheduledEmail>(
    `
      SELECT
        id,
        user_id,
        recipient,
        subject,
        body,
        scheduled_at,
        status,
        attempts,
        sent_at,
        failed_at,
        job_id,
        message_id,
        preview_url,
        last_error,
        hourly_limit,
        rate_limit_group_id,
        created_at,
        updated_at
      FROM emails
      WHERE user_id = $1
        AND id = $2
    `,
    [userId, emailId],
  );

  const email = result.rows[0];

  if (!email) {
    return null;
  }

  return {
    ...email,
    attachments: await listAttachmentsForEmail(email.id),
  };
}
