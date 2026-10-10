import jwt from 'jsonwebtoken';
import { HttpError } from './pipeline.js';

const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is not set');
  return value || 'dev-only-secret';
};

export const signToken = (payload) => jwt.sign(payload, secret(), { expiresIn: '8h' });

/** Require a valid token of the given type ('student' or 'staff'). */
export function requireAuth(type) {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(new HttpError(401, 'Please log in.'));
    try {
      const payload = jwt.verify(token, secret());
      if (payload.type !== type) return next(new HttpError(403, 'You do not have access to this area.'));
      req.user = payload;
      return next();
    } catch {
      return next(new HttpError(401, 'Your session has expired. Please log in again.'));
    }
  };
}

/** Staff role check, enforced on the server (hiding a button is not enough). */
export function requireRole(...roles) {
  return (req, _res, next) =>
    roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'Your role cannot perform this action.'));
}
