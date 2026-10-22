import { RequestHandler, Router } from 'express';
import { HttpError } from '../errors/httpError';
import {
  countActiveLoans,
  listAllLoans,
  listLoansByMember,
  listOverdueLoans,
} from '../repositories/loanRepository';
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
    const { memberId: memberIdQuery, status: statusQuery } = req.query;

    // Without any filter the caller is asking for the whole dataset; memberId-scoped
    // behaviour below is unchanged.
    if (memberIdQuery === undefined && statusQuery === undefined) {
      res.status(200).json(listAllLoans());
      return;
    }

    const memberId = parsePositiveInteger(memberIdQuery);
    if (memberId === null) {
      throw new HttpError(400, 'memberId is required');
    }

    const status = parseStatus(statusQuery);
    res.status(200).json(listLoansByMember(memberId, status));
  } catch (error) {
    next(error);
  }
};

export const overdueLoansHandler: RequestHandler<Record<string, never>> = (req, res) => {
  res.status(200).json(listOverdueLoans(new Date().toISOString()));
};

export const internalLoansRouter = Router();

internalLoansRouter.get('/loans/active-count', activeLoanCountHandler);
internalLoansRouter.get('/loans/overdue', overdueLoansHandler);
internalLoansRouter.get('/loans', listLoansHandler);
