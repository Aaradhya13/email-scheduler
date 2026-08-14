import nodemailer from "nodemailer";
import { env } from "../config/env";

type SendEmailInput = {
  recipient: string;
  subject: string;
  body: string;
  attachments?: {
    filename: string;
    path: string;
    contentType: string;
  }[];
};

export type SendEmailResult = {
  messageId: string;
  previewUrl: string | false;
};

const SEND_TIMEOUT_MS = 45_000;

function createTransporter() {
  if (!env.etherealHost || !env.etherealUser || !env.etherealPassword) {
    throw new Error(
      "Ethereal SMTP is not configured. Set ETHEREAL_HOST, ETHEREAL_PORT, ETHEREAL_USER, and ETHEREAL_PASSWORD.",
    );
  }

  return nodemailer.createTransport({
    host: env.etherealHost,
    port: env.etherealPort,
    secure: env.etherealPort === 465,
    dnsTimeout: 10_000,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth: {
      user: env.etherealUser,
      pass: env.etherealPassword,
    },
  });
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const transporter = createTransporter();

  try {
    const info = await Promise.race([
      transporter.sendMail({
        from: env.etherealFrom,
        to: input.recipient,
        subject: input.subject,
        text: input.body,
        attachments: input.attachments,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("SMTP send timed out"));
        }, SEND_TIMEOUT_MS);
      }),
    ]);

    return {
      messageId: info.messageId,
      previewUrl: nodemailer.getTestMessageUrl(info),
    };
  } finally {
    transporter.close();
  }
}
