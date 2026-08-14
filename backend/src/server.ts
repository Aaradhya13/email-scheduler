import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { env } from "./config/env";
import healthRoutes from "./routes/healthRoutes";
import emailRoutes from "./routes/emailRoutes";
import authRoutes from "./routes/authRoutes";
import { pool } from "./db/postgres";
import { redis } from "./db/redis";
import { emailQueue } from "./queues/emailQueue";
import { configurePassport, passport } from "./config/passport";
import { errorHandler } from "./middleware/errorHandler";

const app = express();
const PgSessionStore = connectPgSimple(session);
const isProduction = env.nodeEnv === "production";

app.set("trust proxy", 1);
configurePassport();

app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: "15mb" }));
app.use(
  session({
    store: new PgSessionStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: false,
    }),
    name: "outbox.sid",
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

app.use("/api", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`Server is running on port ${env.port}`);
});

async function shutdown(): Promise<void> {
  server.close(async () => {
    await emailQueue.close();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
