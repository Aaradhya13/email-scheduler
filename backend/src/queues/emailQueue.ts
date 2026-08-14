import { Queue } from "bullmq";
import { createBullMqRedisConnection } from "./redisConnection";

export const EMAIL_QUEUE_NAME = "email-jobs";

export type EmailJobData = {
  emailId: number;
  recipient: string;
  subject: string;
  body: string;
};

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: createBullMqRedisConnection(),
});
