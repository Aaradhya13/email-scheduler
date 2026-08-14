import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { env } from "./env";
import { findUserById, upsertGoogleUser } from "../services/userService";

function getPrimaryEmail(profile: Profile): string {
  const email = profile.emails?.[0]?.value;

  if (!email) {
    throw new Error("Google profile did not include an email address");
  }

  return email;
}

export function configurePassport(): void {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.googleClientId ?? "",
        clientSecret: env.googleClientSecret ?? "",
        callbackURL: env.googleCallbackUrl ?? "",
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await upsertGoogleUser({
            googleUserId: profile.id,
            name: profile.displayName || getPrimaryEmail(profile),
            email: getPrimaryEmail(profile),
            avatarUrl: profile.photos?.[0]?.value ?? null,
          });

          done(null, user);
        } catch (error) {
          done(error);
        }
      },
    ),
  );
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const user = await findUserById(Number(id));
    done(null, user ?? false);
  } catch (error) {
    done(error);
  }
});

export { passport };
