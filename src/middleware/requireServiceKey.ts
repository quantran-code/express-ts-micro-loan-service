import { RequestHandler } from 'express';
import { config } from '../config';
import { HttpError } from '../errors/httpError';

export const requireServiceKey: RequestHandler = (req, res, next) => {
  const serviceKey = req.header('x-service-key');

  if (!serviceKey || serviceKey !== config.serviceKey) {
    next(new HttpError(401, 'Invalid service key'));
    return;
  }

  next();
};
