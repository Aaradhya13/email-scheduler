import { pool } from "./postgres";

async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      google_user_id VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL CHECK (length(trim(name)) > 0),
      email VARCHAR(320) NOT NULL UNIQUE CHECK (length(trim(email)) > 0),
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS emails (
      id BIGSERIAL PRIMARY KEY,
      recipient VARCHAR(320) NOT NULL CHECK (length(trim(recipient)) > 0),
      subject VARCHAR(500) NOT NULL CHECK (length(trim(subject)) > 0),
      body TEXT NOT NULL CHECK (length(trim(body)) > 0),
      scheduled_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'processing', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      sent_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      job_id VARCHAR(255) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_attachments (
      id BIGSERIAL PRIMARY KEY,
      email_id BIGINT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL CHECK (length(trim(filename)) > 0),
      mime_type VARCHAR(255) NOT NULL CHECK (length(trim(mime_type)) > 0),
      size INTEGER NOT NULL CHECK (size >= 0),
      storage_path TEXT NOT NULL CHECK (length(trim(storage_path)) > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE emails
      ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS message_id TEXT,
      ADD COLUMN IF NOT EXISTS preview_url TEXT,
      ADD COLUMN IF NOT EXISTS last_error TEXT,
      ADD COLUMN IF NOT EXISTS hourly_limit INTEGER CHECK (hourly_limit IS NULL OR hourly_limit > 0),
      ADD COLUMN IF NOT EXISTS rate_limit_group_id TEXT;

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_google_user_id
      ON users (google_user_id);

    CREATE INDEX IF NOT EXISTS idx_users_email
      ON users (email);

    CREATE INDEX IF NOT EXISTS idx_emails_status
      ON emails (status);

    CREATE INDEX IF NOT EXISTS idx_emails_scheduled_at
      ON emails (scheduled_at);

    CREATE INDEX IF NOT EXISTS idx_emails_status_scheduled_at
      ON emails (status, scheduled_at);

    CREATE INDEX IF NOT EXISTS idx_emails_job_id
      ON emails (job_id);

    CREATE INDEX IF NOT EXISTS idx_emails_sent_at
      ON emails (sent_at);

    CREATE INDEX IF NOT EXISTS idx_emails_message_id
      ON emails (message_id);

    CREATE INDEX IF NOT EXISTS idx_emails_user_id
      ON emails (user_id);

    CREATE INDEX IF NOT EXISTS idx_emails_user_id_scheduled_at
      ON emails (user_id, scheduled_at);

    CREATE INDEX IF NOT EXISTS idx_emails_user_id_sent_at
      ON emails (user_id, sent_at);

    CREATE INDEX IF NOT EXISTS idx_emails_rate_limit_group_id
      ON emails (rate_limit_group_id);

    CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id
      ON email_attachments (email_id);

    CREATE INDEX IF NOT EXISTS idx_user_sessions_expire
      ON user_sessions (expire);

    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS set_users_updated_at ON users;
    CREATE TRIGGER set_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();

    DROP TRIGGER IF EXISTS set_emails_updated_at ON emails;
    CREATE TRIGGER set_emails_updated_at
      BEFORE UPDATE ON emails
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  `);
}

initializeDatabase()
  .then(() => {
    console.log("Database initialized successfully.");
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
