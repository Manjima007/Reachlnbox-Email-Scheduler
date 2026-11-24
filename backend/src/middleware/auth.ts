import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env';
import { prisma } from '../db';

export const AUTH_COOKIE = 'reachinbox_sid';

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '30d' });
}

export function setSessionCookie(res: Response, userId: string) {
  res.cookie(AUTH_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export interface AuthedRequest extends Request {
  user?: Awaited<ReturnType<typeof prisma.user.findUnique>>;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token =
    (req.cookies?.[AUTH_COOKIE] as string | undefined) ??
    (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  jwt.verify(token, env.JWT_SECRET, (verifyError, payload) => {
    if (verifyError || !(payload as { sub?: string })?.sub) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
    prisma.user.findUnique({ where: { id: (payload as { sub: string }).sub } })
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: 'Session is no longer valid' });
          return;
        }
        req.user = user;
        next();
      })
      .catch(() => {
        res.status(500).json({ error: 'Authentication check failed' });
      });
  });
}
