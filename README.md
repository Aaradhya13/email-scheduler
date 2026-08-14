# Outbox Labs Email Scheduler

A full-stack email scheduler built with React, Express, PostgreSQL, Redis,
BullMQ, Nodemailer, Ethereal SMTP, and Google OAuth.

The app lets a user log in with Google, compose an email, upload CSV leads, add
attachments, choose immediate send or scheduled send, and track scheduled/sent
emails. Scheduling is handled by BullMQ delayed jobs in Redis. No cron jobs are
used.

## Demo

A short walkthrough demonstrating Google authentication, CSV recipients,
attachments, scheduled sending, hourly rate limiting, email delivery, and
restart persistence.

[Watch the Demo Video](https://drive.google.com/file/d/1cC_6jLKQe2AjEWlbXKUM-W2kONrM8T2g/view?usp=drivesdk)

## Tech Stack

- Frontend: React, TypeScript, Vite, CSS
- Backend: Node.js, TypeScript, Express
- Database: PostgreSQL
- Queue/cache: Redis + BullMQ
- Email: Nodemailer + Ethereal SMTP
- Auth: Google OAuth with PostgreSQL-backed sessions

## Project Structure

```text
outbox_labs/
  backend/
    src/
      config/
      controllers/
      db/
      middleware/
      queues/
      routes/
      services/
      workers/
  frontend/
    src/
      components/
      context/
      lib/
      pages/
  docker-compose.yml
```

## Environment

Backend variables are in `backend/.env`. Use `backend/.env.example` as the
template.

```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
SESSION_SECRET=replace-with-a-long-random-string

DATABASE_URL=postgresql://postgres:postgres@localhost:5433/outbox_scheduler

REDIS_HOST=localhost
REDIS_PORT=6379

WORKER_CONCURRENCY=5
MIN_EMAIL_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=200

ATTACHMENT_UPLOAD_DIR=uploads/email-attachments
MAX_ATTACHMENT_SIZE_BYTES=5242880

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

ETHEREAL_HOST=smtp.ethereal.email
ETHEREAL_PORT=587
ETHEREAL_USER=
ETHEREAL_PASSWORD=
ETHEREAL_FROM="Outbox Labs <no-reply@outbox.test>"
```

Do not commit real Google or Ethereal credentials.

## Running Locally

Start PostgreSQL and Redis:

```powershell
docker compose up -d
```

Initialize/update the database:

```powershell
cd backend
npm.cmd run db:init
```

Start the API:

```powershell
cd backend
npm.cmd run dev
```

Start the worker in another terminal:

```powershell
cd backend
npm.cmd run worker
```

Start the frontend:

```powershell
cd frontend
npm.cmd run dev
```

Open:

```text
http://localhost:5173
```

## Main Flow

```text
Google login
  -> Compose email
  -> optional CSV recipients and attachments
  -> POST /api/emails
  -> PostgreSQL email + attachment rows
  -> BullMQ delayed job in Redis
  -> worker claims the email
  -> Redis send-delay/rate-limit check
  -> Nodemailer sends through Ethereal
  -> PostgreSQL status becomes sent
```

Immediate Send still goes through the same queue path. The frontend schedules it
for a near-future timestamp instead of sending directly from the browser or API
request.

## Features

- Google OAuth login
- HTTP-only session cookie stored in PostgreSQL
- Authenticated email ownership by `user_id`
- Scheduled mailbox
- Sent mailbox
- Email detail page
- CSV/text lead upload
- Multiple recipients from one compose screen
- Delay between recipients
- Per-compose hourly limit
- Global backend hourly safety limit
- Minimum delay between sends
- Multiple attachments per email
- Image previews and file cards in email detail
- Ethereal preview URL for sent email

The backend API accepts one recipient per `POST /api/emails`. For a compose batch,
the frontend sends one request per recipient with the same subject/body and a
shared `batchId`.

## Database Tables

- `users`: Google OAuth user profile.
- `user_sessions`: Express session data.
- `emails`: scheduled email records, status, job id, rate-limit info, SMTP result.
- `email_attachments`: one-to-many attachment metadata for emails.

Attachment files are stored under `backend/uploads/email-attachments` by default.
That folder is ignored by git.

## API

Auth:

- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Emails:

- `POST /api/emails`
- `GET /api/emails/scheduled`
- `GET /api/emails/sent`
- `GET /api/emails/:id`
- `GET /api/emails/:id/attachments/:attachmentId`

Development/test endpoints:

- `POST /api/emails/test-schedule`
- `POST /api/emails/test-schedule-bulk`
- `GET /api/emails`

The development endpoints are useful for local queue/rate-limit testing and
should not be exposed as public production endpoints.

## Scheduling And Rate Limiting

BullMQ delayed jobs are the scheduler. Redis holds the queue and the rate-limit
state.

Redis keys used by the worker:

- `email-send-coordination:last-send-at-ms`
- `email-rate-limit:global:<YYYY-MM-DD-HH>`
- `email-rate-limit:batch:<group-id>:<YYYY-MM-DD-HH>`

The worker checks the minimum send delay, global hourly limit, and optional batch
hourly limit in one Redis Lua script. If a job is rate-limited, the worker creates
a new delayed BullMQ job, updates `emails.job_id`, sets the email back to
`scheduled`, and does not count it as an SMTP failure.

## Attachments

Attachments are sent as part of `POST /api/emails` using base64 file data. The
backend:

- validates allowed MIME types
- enforces `MAX_ATTACHMENT_SIZE_BYTES`
- sanitizes filenames
- stores files under the configured upload directory
- stores metadata in `email_attachments`
- sends the files through Nodemailer when the worker processes the email
- returns metadata to the email detail page

The detail page displays image attachments as thumbnails and other files as file
cards. Attachment download routes are protected by the same session ownership
checks as email detail.

## Google OAuth Setup

In Google Cloud Console:

1. Create/select a project.
2. Configure the OAuth consent screen.
3. Create OAuth 2.0 credentials for a web app.
4. Add this redirect URI:

```text
http://localhost:5000/api/auth/google/callback
```

5. Put the client ID and secret in `backend/.env`.

The frontend never receives the Google client secret and does not store OAuth
tokens in localStorage.

## Notes

- The local project uses one Ethereal SMTP account from `.env`.
- SMTP delivery and the database update are not one atomic transaction. The worker
  avoids normal duplicate sends with database row locking and job-id checks, but
  exactly-once SMTP delivery cannot be guaranteed if a process crashes after SMTP
  accepts the message and before PostgreSQL is updated.
- Large production file storage would normally use object storage. This assignment
  stores files on local disk to keep the setup simple.

## Quick Checks

Backend:

```powershell
cd backend
npm.cmd run build
```

Frontend:

```powershell
cd frontend
npm.cmd run build
```
