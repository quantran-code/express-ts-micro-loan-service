import { RequestHandler, Router } from 'express';
import { HttpError } from '../errors/httpError';
import { countActiveLoans, listLoansByMember } from '../repositories/loanRepository';
import type { LoanStatusFilter } from '../repositories/loanRepository';

export interface InternalLoansQuery {
  memberId?: string;
  status?: string;
}

export interface ActiveCountQuery {
  memberId?: string;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function parseStatus(value: string | undefined): LoanStatusFilter | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'active' || value === 'returned') {
    return value;
  }

  throw new HttpError(400, 'status must be active or returned');
}

export const activeLoanCountHandler: RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  ActiveCountQuery
> = (req, res, next) => {
  try {
    const memberId = parsePositiveInteger(req.query.memberId);
    if (memberId === null) {
      throw new HttpError(400, 'memberId is required');
    }

    res.status(200).json({ count: countActiveLoans(memberId) });
  } catch (error) {
    next(error);
  }
};

export const listLoansHandler: RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  InternalLoansQuery
> = (req, res, next) => {
  try {
    const memberId = parsePositiveInteger(req.query.memberId);
    if (memberId === null) {
      throw new HttpError(400, 'memberId is required');
    }

    const status = parseStatus(req.query.status);
    res.status(200).json(listLoansByMember(memberId, status));
  } catch (error) {
    next(error);
  }
};

export const internalLoansRouter = Router();

internalLoansRouter.get('/loans/active-count', activeLoanCountHandler);
internalLoansRouter.get('/loans', listLoansHandler);
