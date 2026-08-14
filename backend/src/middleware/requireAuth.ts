import { NextFunction, Request, Response } from "express";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ message: "Unauthenticated." });
    return;
  }

  next();
}
