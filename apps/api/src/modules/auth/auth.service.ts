import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import type { Db } from '../../core/db';
import { AppError } from '../../core/errors';

const MODULE = 'auth';

export function signToken(memberId: string): string {
  return jwt.sign({ sub: memberId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): string | null {
  try {
    const p = jwt.verify(token, env.jwtSecret);
    return typeof p === 'object' && typeof p.sub === 'string' ? p.sub : null;
  } catch {
    return null;
  }
}

export async function login(db: Db, email: string, password: string) {
  const m = await db.member.findUnique({ where: { email: email.toLowerCase() } });
  // Same message for unknown email and wrong password (no account enumeration).
  if (!m || !(await bcrypt.compare(password, m.passwordHash))) {
    throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.', MODULE);
  }
  return { token: signToken(m.id), member: m };
}
