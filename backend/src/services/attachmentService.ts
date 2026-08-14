import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { env } from "../config/env";
import { pool } from "../db/postgres";

const SAFE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type IncomingAttachment = {
  filename?: string;
  mimeType?: string;
  data?: string;
};

export type EmailAttachment = {
  id: number;
  email_id: number;
  filename: string;
  mime_type: string;
  size: number;
  storage_path: string;
  created_at: Date;
};

export type StoredAttachmentInput = {
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
};

function sanitizeFilename(filename: string): string {
  const baseName = path.basename(filename).replace(/[^\w.\- ]+/g, "_").trim();
  return baseName.slice(0, 180) || "attachment";
}

function decodeBase64Payload(data: string): Buffer {
  const payload = data.includes(",") ? data.split(",").pop() ?? "" : data;
  return Buffer.from(payload, "base64");
}

export function formatAttachment(attachment: EmailAttachment) {
  return {
    id: String(attachment.id),
    filename: attachment.filename,
    mimeType: attachment.mime_type,
    size: attachment.size,
    url: `/api/emails/${attachment.email_id}/attachments/${attachment.id}`,
    createdAt: attachment.created_at,
  };
}

export async function storeIncomingAttachments(
  attachments: IncomingAttachment[] | undefined,
): Promise<StoredAttachmentInput[]> {
  if (!attachments?.length) {
    return [];
  }

  const uploadRoot = path.resolve(process.cwd(), env.attachmentUploadDir);
  await mkdir(uploadRoot, { recursive: true });

  const stored: StoredAttachmentInput[] = [];

  for (const attachment of attachments) {
    const filename = sanitizeFilename(attachment.filename ?? "");
    const mimeType = (attachment.mimeType ?? "").trim().toLowerCase();

    if (!SAFE_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported attachment type: ${mimeType || "unknown"}`);
    }

    if (!attachment.data) {
      throw new Error(`Attachment ${filename} is missing file data.`);
    }

    const buffer = decodeBase64Payload(attachment.data);

    if (buffer.length > env.maxAttachmentSizeBytes) {
      throw new Error(`Attachment ${filename} exceeds the size limit.`);
    }

    const storedName = `${crypto.randomUUID()}-${filename}`;
    const absolutePath = path.join(uploadRoot, storedName);
    const relativePath = path
      .relative(process.cwd(), absolutePath)
      .replace(/\\/g, "/");

    await writeFile(absolutePath, buffer, { flag: "wx" });

    stored.push({
      filename,
      mimeType,
      size: buffer.length,
      storagePath: relativePath,
    });
  }

  return stored;
}

export async function insertEmailAttachments(
  emailId: number,
  attachments: StoredAttachmentInput[],
): Promise<void> {
  for (const attachment of attachments) {
    await pool.query(
      `
        INSERT INTO email_attachments (
          email_id,
          filename,
          mime_type,
          size,
          storage_path
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        emailId,
        attachment.filename,
        attachment.mimeType,
        attachment.size,
        attachment.storagePath,
      ],
    );
  }
}

export async function listAttachmentsForEmail(
  emailId: number,
): Promise<EmailAttachment[]> {
  const result = await pool.query<EmailAttachment>(
    `
      SELECT id, email_id, filename, mime_type, size, storage_path, created_at
      FROM email_attachments
      WHERE email_id = $1
      ORDER BY id ASC
    `,
    [emailId],
  );

  return result.rows;
}

export async function findAttachmentForUser(
  userId: number,
  emailId: number,
  attachmentId: number,
): Promise<EmailAttachment | null> {
  const result = await pool.query<EmailAttachment>(
    `
      SELECT
        email_attachments.id,
        email_attachments.email_id,
        email_attachments.filename,
        email_attachments.mime_type,
        email_attachments.size,
        email_attachments.storage_path,
        email_attachments.created_at
      FROM email_attachments
      JOIN emails ON emails.id = email_attachments.email_id
      WHERE emails.user_id = $1
        AND email_attachments.email_id = $2
        AND email_attachments.id = $3
    `,
    [userId, emailId, attachmentId],
  );

  return result.rows[0] ?? null;
}

export function getAttachmentAbsolutePath(attachment: EmailAttachment): string {
  const uploadRoot = path.resolve(process.cwd(), env.attachmentUploadDir);
  const absolutePath = path.resolve(process.cwd(), attachment.storage_path);

  if (!absolutePath.startsWith(uploadRoot)) {
    throw new Error("Invalid attachment storage path.");
  }

  return absolutePath;
}
