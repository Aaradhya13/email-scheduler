import { Router } from "express";
import { env } from "../config/env";
import { passport } from "../config/passport";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

function googleOAuthConfigured(): boolean {
  return Boolean(
    env.googleClientId && env.googleClientSecret && env.googleCallbackUrl,
  );
}

router.get(
  "/google",
  (_req, res, next) => {
    if (!googleOAuthConfigured()) {
      res.status(500).json({ message: "Google OAuth is not configured." });
      return;
    }

    next();
  },
  passport.authenticate("google", {
    scope: ["profile", "email"],
  }),
);

router.get(
  "/google/callback",
  (_req, res, next) => {
    if (!googleOAuthConfigured()) {
      res.status(500).json({ message: "Google OAuth is not configured." });
      return;
    }

    next();
  },
  passport.authenticate("google", {
    failureRedirect: `${env.frontendUrl}/login?error=oauth_failed`,
  }),
  (_req, res) => {
    res.redirect(env.frontendUrl);
  },
);

router.get("/me", requireAuth, (req, res) => {
  const user = req.user!;

  res.json({
    user: {
      id: String(user.id),
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
  });
});

router.post("/logout", requireAuth, (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) {
      next(logoutError);
      return;
    }

    req.session.destroy((sessionError) => {
      if (sessionError) {
        next(sessionError);
        return;
      }

      res.clearCookie("outbox.sid");
      res.status(204).send();
    });
  });
});

export default router;
