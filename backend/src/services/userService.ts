import { pool } from "../db/postgres";

export type AppUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

type GoogleUserInput = {
  googleUserId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

function mapUser(row: {
  id: string | number;
  name: string;
  email: string;
  avatar_url: string | null;
}): AppUser {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
  };
}

export async function upsertGoogleUser(input: GoogleUserInput): Promise<AppUser> {
  const result = await pool.query(
    `
      INSERT INTO users (google_user_id, name, email, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (google_user_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        avatar_url = EXCLUDED.avatar_url
      RETURNING id, name, email, avatar_url
    `,
    [input.googleUserId, input.name, input.email, input.avatarUrl],
  );

  return mapUser(result.rows[0]);
}

export async function findUserById(id: number): Promise<AppUser | null> {
  const result = await pool.query(
    `
      SELECT id, name, email, avatar_url
      FROM users
      WHERE id = $1
    `,
    [id],
  );

  const row = result.rows[0];

  return row ? mapUser(row) : null;
}
