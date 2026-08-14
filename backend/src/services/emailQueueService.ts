import { emailQueue, EmailJobData } from "../queues/emailQueue";

type AddEmailJobInput = EmailJobData & {
  scheduledAt: Date;
};

export async function addEmailJob(input: AddEmailJobInput): Promise<string> {
  const delay = Math.max(input.scheduledAt.getTime() - Date.now(), 0);

  const job = await emailQueue.add(
    "send-email",
    {
      emailId: input.emailId,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
    },
    {
      delay,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: false,
      removeOnFail: false,
    },
  );

  if (!job.id) {
    throw new Error("BullMQ did not return a job id");
  }

  return String(job.id);
}
