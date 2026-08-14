import { Router } from "express";
import {
  createEmail,
  getEmailAttachment,
  getEmailById,
  getEmails,
  getScheduledEmails,
  getSentEmails,
  testScheduleBulkEmails,
  testScheduleEmail,
} from "../controllers/emailController";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.post("/", requireAuth, createEmail);
router.get("/scheduled", requireAuth, getScheduledEmails);
router.get("/sent", requireAuth, getSentEmails);
router.post("/test-schedule", testScheduleEmail);
router.post("/test-schedule-bulk", testScheduleBulkEmails);
router.get("/", getEmails);
router.get("/:id/attachments/:attachmentId", requireAuth, getEmailAttachment);
router.get("/:id", requireAuth, getEmailById);

export default router;
