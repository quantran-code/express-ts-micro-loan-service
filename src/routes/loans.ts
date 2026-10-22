import { Request, RequestHandler, Router } from 'express';
import { borrowCopy, getBook, returnCopy } from '../clients/catalogClient';
import { getMember } from '../clients/memberClient';
import { HttpError } from '../errors/httpError';
import { requireUser } from '../middleware/requireUser';
import {
  Loan,
  countActiveLoans,
  createLoan,
  findActiveLoan,
  findLoanById,
  listOverdueLoans,
  markReturned,
} from '../repositories/loanRepository';

export interface LoanIdParams {
  id: string;
}

export interface CreateLoanBody {
  bookId?: unknown;
  memberId?: unknown;
}

export interface LoanResponse {
  id: number;
  bookId: number;
  memberId: number;
  borrowedAt: string;
  returnedAt: string | null;
}

const LOAN_PERIOD_DAYS = 14;
const MAX_ACTIVE_LOANS = 3;

export function toLoanResponse(loan: Loan): LoanResponse {
  return {
    id: loan.id,
    bookId: loan.bookId,
    memberId: loan.memberId,
    borrowedAt: loan.borrowedAt,
    returnedAt: loan.returnedAt,
  };
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

export function resolveMemberId(req: Request, body: CreateLoanBody): number {
  if (req.user?.role === 'member') {
    const ownMemberId = req.user.memberId;
    if (ownMemberId === null) {
      throw new HttpError(403, 'No member id for this caller');
    }

    return ownMemberId;
  }

  const memberId = parsePositiveInteger(body.memberId);
  if (memberId === null) {
    throw new HttpError(400, 'memberId is required');
  }

  return memberId;
}

export const createLoanHandler: RequestHandler<
  Record<string, never>,
  unknown,
  CreateLoanBody
> = async (req, res, next) => {
  try {
    const body: CreateLoanBody = req.body ?? {};
    const memberId = resolveMemberId(req, body);

    const bookId = parsePositiveInteger(body.bookId);
    if (bookId === null) {
      throw new HttpError(400, 'bookId is required');
    }

    const bookResult = await getBook(bookId);
    if (!bookResult.ok) {
      throw new HttpError(bookResult.status, bookResult.error);
    }

    const memberResult = await getMember(memberId);
    if (!memberResult.ok) {
      throw new HttpError(memberResult.status, memberResult.error);
    }

    if (findActiveLoan(bookId, memberId)) {
      throw new HttpError(409, 'This member already has an active loan for this book');
    }

    if (countActiveLoans(memberId) >= MAX_ACTIVE_LOANS) {
      throw new HttpError(409, 'A member may have at most 3 active loans');
    }

    const borrowResult = await borrowCopy(bookId);
    if (!borrowResult.ok) {
      throw new HttpError(borrowResult.status, borrowResult.error);
    }

    const borrowedAt = new Date().toISOString();
    const dueDate = new Date(
      new Date(borrowedAt).getTime() + LOAN_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const loan = createLoan({ bookId, memberId, borrowedAt, dueDate });
    res.status(201).json(toLoanResponse(loan));
  } catch (error) {
    next(error);
  }
};

export const returnLoanHandler: RequestHandler<LoanIdParams> = async (req, res, next) => {
  try {
    const loanId = parsePositiveInteger(req.params.id);
    const loan = loanId === null ? undefined : findLoanById(loanId);

    if (!loan) {
      throw new HttpError(404, 'Loan not found');
    }

    const isLibrarian = req.user?.role === 'librarian';
    const isLoanMember = req.user?.role === 'member' && req.user.memberId === loan.memberId;

    if (!isLibrarian && !isLoanMember) {
      throw new HttpError(403, 'Not allowed to return this loan');
    }

    if (loan.returnedAt !== null) {
      throw new HttpError(409, 'This loan has already been returned');
    }

    const catalogResult = await returnCopy(loan.bookId);
    if (!catalogResult.ok && catalogResult.status !== 404) {
      throw new HttpError(catalogResult.status, catalogResult.error);
    }

    const returned = markReturned(loan.id, new Date().toISOString());
    res.status(200).json(toLoanResponse(returned ?? loan));
  } catch (error) {
    next(error);
  }
};

export const overdueLoansHandler: RequestHandler<Record<string, never>> = (req, res, next) => {
  if (req.user?.role !== 'librarian') {
    next(new HttpError(403, 'Librarian role required'));
    return;
  }

  res.status(200).json(listOverdueLoans(new Date().toISOString()));
};

export const loansRouter = Router();

loansRouter.use(requireUser);

loansRouter.get('/overdue', overdueLoansHandler);
loansRouter.post('/', createLoanHandler);
loansRouter.post('/:id/return', returnLoanHandler);
