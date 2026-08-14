import { Request, Response } from "express";
import crypto from "crypto";
import { createReadStream } from "fs";
import {
  createBulkTestScheduledEmails,
  createScheduledEmailForUser,
  createTestScheduledEmail,
  findEmailForUser,
  listEmails,
  listScheduledEmailsForUser,
  listSentEmailsForUser,
  ScheduledEmail,
} from "../services/emailService";
import {
  findAttachmentForUser,
  formatAttachment,
  getAttachmentAbsolutePath,
  IncomingAttachment,
  storeIncomingAttachments,
} from "../services/attachmentService";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatEmail(email: ScheduledEmail) {
  return {
    id: String(email.id),
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    scheduledAt: email.scheduled_at,
    status: email.status,
    attempts: email.attempts,
    sentAt: email.sent_at,
    failedAt: email.failed_at,
    jobId: email.job_id,
    messageId: email.message_id,
    previewUrl: email.preview_url,
    lastError: email.last_error,
    hourlyLimit: email.hourly_limit,
    rateLimitGroupId: email.rate_limit_group_id,
    attachments: (email.attachments ?? []).map(formatAttachment),
    createdAt: email.created_at,
    updatedAt: email.updated_at,
  };
}

function createRateLimitGroupId(input: {
  userId: number;
  subject: string;
  body: string;
  hourlyLimit: number | null;
  batchId?: string;
}): string | null {
  if (!input.hourlyLimit) {
    return null;
  }

  const providedBatchId = input.batchId?.trim();

  if (providedBatchId) {
    return `user:${input.userId}:batch:${providedBatchId.slice(0, 100)}`;
  }

  const composeWindow = Math.floor(Date.now() / 60_000);
  const digest = crypto
    .createHash("sha256")
    .update(
      [
        input.userId,
        input.subject.trim().toLowerCase(),
        input.body.trim(),
        input.hourlyLimit,
        composeWindow,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);

  return `user:${input.userId}:compose:${digest}`;
}

export async function testScheduleEmail(
  req: Request,
  res: Response,
): Promise<void> {
  const { recipient, subject, body, delaySeconds } = req.body as {
    recipient?: string;
    subject?: string;
    body?: string;
    delaySeconds?: number;
  };

  if (!recipient?.trim() || !subject?.trim() || !body?.trim()) {
    res.status(400).json({
      message: "recipient, subject, and body are required.",
    });
    return;
  }

  const parsedDelaySeconds = Number(delaySeconds ?? 60);

  if (!Number.isFinite(parsedDelaySeconds) || parsedDelaySeconds < 0) {
    res.status(400).json({
      message: "delaySeconds must be a non-negative number.",
    });
    return;
  }

  const email = await createTestScheduledEmail({
    recipient: recipient.trim(),
    subject: subject.trim(),
    body: body.trim(),
    delaySeconds: parsedDelaySeconds,
  });

  res.status(201).json({
    email,
  });
}

export async function getEmails(_req: Request, res: Response): Promise<void> {
  const emails = await listEmails();

  res.json({
    emails,
  });
}

export async function testScheduleBulkEmails(
  req: Request,
  res: Response,
): Promise<void> {
  const { recipientPrefix, subject, body, delaySeconds, count } = req.body as {
    recipientPrefix?: string;
    subject?: string;
    body?: string;
    delaySeconds?: number;
    count?: number;
  };

  if (!recipientPrefix?.trim() || !subject?.trim() || !body?.trim()) {
    res.status(400).json({
      message: "recipientPrefix, subject, and body are required.",
    });
    return;
  }

  const parsedDelaySeconds = Number(delaySeconds ?? 0);
  const parsedCount = Number(count ?? 10);

  if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 100) {
    res.status(400).json({
      message: "count must be an integer between 1 and 100.",
    });
    return;
  }

  if (!Number.isFinite(parsedDelaySeconds) || parsedDelaySeconds < 0) {
    res.status(400).json({
      message: "delaySeconds must be a non-negative number.",
    });
    return;
  }

  const emails = await createBulkTestScheduledEmails({
    recipientPrefix: recipientPrefix.trim(),
    subject: subject.trim(),
    body: body.trim(),
    delaySeconds: parsedDelaySeconds,
    count: parsedCount,
  });

  res.status(201).json({
    count: emails.length,
    emails,
  });
}

export async function createEmail(req: Request, res: Response): Promise<void> {
  const { recipient, subject, body, scheduledAt, hourlyLimit, batchId, attachments } = req.body as {
    recipient?: string;
    subject?: string;
    body?: string;
    scheduledAt?: string;
    hourlyLimit?: number;
    batchId?: string;
    attachments?: IncomingAttachment[];
  };

  if (!recipient?.trim() || !EMAIL_PATTERN.test(recipient.trim())) {
    res.status(400).json({ message: "recipient must be a valid email address." });
    return;
  }

  if (!subject?.trim()) {
    res.status(400).json({ message: "subject is required." });
    return;
  }

  if (!body?.trim()) {
    res.status(400).json({ message: "body is required." });
    return;
  }

  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;

  if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
    res.status(400).json({ message: "scheduledAt must be a valid timestamp." });
    return;
  }

  if (scheduledDate.getTime() <= Date.now()) {
    res.status(400).json({ message: "scheduledAt must be in the future." });
    return;
  }

  const parsedHourlyLimit =
    hourlyLimit === undefined || hourlyLimit === null || Number(hourlyLimit) === 0
      ? null
      : Number(hourlyLimit);

  if (
    parsedHourlyLimit !== null &&
    (!Number.isInteger(parsedHourlyLimit) || parsedHourlyLimit < 1)
  ) {
    res.status(400).json({ message: "hourlyLimit must be a positive integer." });
    return;
  }

  let storedAttachments;

  try {
    storedAttachments = await storeIncomingAttachments(attachments);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Invalid attachment.",
    });
    return;
  }

  const email = await createScheduledEmailForUser({
    userId: req.user!.id,
    recipient: recipient.trim(),
    subject: subject.trim(),
    body: body.trim(),
    scheduledAt: scheduledDate,
    hourlyLimit: parsedHourlyLimit,
    rateLimitGroupId: createRateLimitGroupId({
      userId: req.user!.id,
      subject,
      body,
      hourlyLimit: parsedHourlyLimit,
      batchId,
    }),
    attachments: storedAttachments,
  });

  res.status(201).json({
    email: formatEmail(email),
  });
}

export async function getScheduledEmails(
  req: Request,
  res: Response,
): Promise<void> {
  const emails = await listScheduledEmailsForUser(req.user!.id);

  res.json({
    emails: emails.map((email) => ({
      id: String(email.id),
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      scheduledAt: email.scheduled_at,
      status: email.status,
      hourlyLimit: email.hourly_limit,
      rateLimitGroupId: email.rate_limit_group_id,
      attachments: (email.attachments ?? []).map(formatAttachment),
      createdAt: email.created_at,
    })),
  });
}

export async function getSentEmails(req: Request, res: Response): Promise<void> {
  const emails = await listSentEmailsForUser(req.user!.id);

  res.json({
    emails: emails.map((email) => ({
      id: String(email.id),
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      sentAt: email.sent_at,
      status: email.status,
      messageId: email.message_id,
      previewUrl: email.preview_url,
      hourlyLimit: email.hourly_limit,
      rateLimitGroupId: email.rate_limit_group_id,
      attachments: (email.attachments ?? []).map(formatAttachment),
    })),
  });
}

export async function getEmailAttachment(
  req: Request,
  res: Response,
): Promise<void> {
  const emailId = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);

  if (
    !Number.isInteger(emailId) ||
    emailId < 1 ||
    !Number.isInteger(attachmentId) ||
    attachmentId < 1
  ) {
    res.status(404).json({ message: "Attachment not found." });
    return;
  }

  const attachment = await findAttachmentForUser(
    req.user!.id,
    emailId,
    attachmentId,
  );

  if (!attachment) {
    res.status(404).json({ message: "Attachment not found." });
    return;
  }

  res.setHeader("Content-Type", attachment.mime_type);
  res.setHeader("Content-Length", attachment.size);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
  );

  createReadStream(getAttachmentAbsolutePath(attachment)).pipe(res);
}

export async function getEmailById(req: Request, res: Response): Promise<void> {
  const emailId = Number(req.params.id);

  if (!Number.isInteger(emailId) || emailId < 1) {
    res.status(404).json({ message: "Email not found." });
    return;
  }

  const email = await findEmailForUser(req.user!.id, emailId);

  if (!email) {
    res.status(404).json({ message: "Email not found." });
    return;
  }

  res.json({
    email: formatEmail(email),
  });
}
