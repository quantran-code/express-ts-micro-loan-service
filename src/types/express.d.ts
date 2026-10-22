import type { RequestUser } from '../middleware/requireUser';

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

export {};
