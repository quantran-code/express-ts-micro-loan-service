import { RequestHandler } from 'express';
import { HttpError } from '../errors/httpError';

export interface RequestUser {
  id: number;
  role: string;
  memberId: number | null;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

export const requireUser: RequestHandler = (req, res, next) => {
  const userId = parsePositiveInteger(req.header('x-user-id'));
  const role = req.header('x-user-role');

  if (userId === null || !role) {
    next(new HttpError(401, 'Invalid user identity'));
    return;
  }

  req.user = {
    id: userId,
    role,
    memberId: parsePositiveInteger(req.header('x-user-member-id')),
  };

  next();
};
