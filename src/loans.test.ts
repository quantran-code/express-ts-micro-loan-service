import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from './app';
import { borrowCopy, getBook, returnCopy } from './clients/catalogClient';
import type { CatalogBook } from './clients/catalogClient';
import { getMember } from './clients/memberClient';
import type { Member } from './clients/memberClient';
import { config } from './config';
import {
  createLoan,
  findActiveLoan,
  findLoanById,
  markReturned,
  resetLoans,
} from './repositories/loanRepository';
import type { Loan } from './repositories/loanRepository';

vi.mock('./clients/catalogClient', () => ({
  getBook: vi.fn(),
  borrowCopy: vi.fn(),
  returnCopy: vi.fn(),
}));

vi.mock('./clients/memberClient', () => ({
  getMember: vi.fn(),
}));

interface LoanBody {
  id: number;
  bookId: number;
  memberId: number;
  borrowedAt: string;
  returnedAt: string | null;
}

interface ErrorBody {
  error: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const sampleBook: CatalogBook = {
  id: 1,
  title: 'Refactoring',
  author: 'Martin Fowler',
  isbn: '978-0-13-475759-9',
  totalCopies: 2,
  availableCopies: 2,
};

const sampleMember: Member = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
};

function identityHeaders(
  role: string,
  userId = 1,
  memberId: number | null = null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-service-key': config.serviceKey,
    'x-user-id': String(userId),
    'x-user-role': role,
  };

  if (memberId !== null) {
    headers['x-user-member-id'] = String(memberId);
  }

  return headers;
}

function seedLoan(bookId: number, memberId: number, dueDate: string): Loan {
  return createLoan({
    bookId,
    memberId,
    borrowedAt: '2024-01-01T00:00:00.000Z',
    dueDate,
  });
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

beforeEach(() => {
  resetLoans();

  vi.mocked(getBook).mockReset().mockResolvedValue({ ok: true, data: sampleBook });
  vi.mocked(borrowCopy).mockReset().mockResolvedValue({ ok: true, data: sampleBook });
  vi.mocked(returnCopy).mockReset().mockResolvedValue({ ok: true, data: sampleBook });
  vi.mocked(getMember).mockReset().mockResolvedValue({ ok: true, data: sampleMember });
});

describe('service key and caller identity gates', () => {
  it('rejects a request without x-service-key and never reaches the repository', async () => {
    const response = await request(app)
      .post('/loans')
      .set({ 'x-user-id': '1', 'x-user-role': 'member', 'x-user-member-id': '7' })
      .send({ bookId: 1 });

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
    expect(vi.mocked(getBook)).not.toHaveBeenCalled();
    expect(findActiveLoan(1, 7)).toBeUndefined();
  });

  it('rejects a request with the wrong x-service-key', async () => {
    const response = await request(app)
      .post('/loans')
      .set({
        'x-service-key': 'wrong-key',
        'x-user-id': '1',
        'x-user-role': 'member',
        'x-user-member-id': '7',
      })
      .send({ bookId: 1 });

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });

  it('rejects a /loans request without x-user-id', async () => {
    const response = await request(app)
      .post('/loans')
      .set({ 'x-service-key': config.serviceKey, 'x-user-role': 'member' })
      .send({ bookId: 1 });

    expect(response.status).toBe(401);
    expect(vi.mocked(getBook)).not.toHaveBeenCalled();
  });

  it('rejects a /loans request without x-user-role', async () => {
    const response = await request(app)
      .post('/loans')
      .set({ 'x-service-key': config.serviceKey, 'x-user-id': '1' })
      .send({ bookId: 1 });

    expect(response.status).toBe(401);
    expect(vi.mocked(getBook)).not.toHaveBeenCalled();
  });

  it('still serves /health without any headers', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'loan-service' });
  });
});

describe('POST /loans', () => {
  it('creates a loan and responds 201 with exactly the documented keys', async () => {
    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1 });

    expect(response.status).toBe(201);

    const body = response.body as LoanBody;
    expect(Object.keys(body).sort()).toEqual([
      'bookId',
      'borrowedAt',
      'id',
      'memberId',
      'returnedAt',
    ]);
    expect(body).not.toHaveProperty('dueDate');
    expect(body.id).toBe(1);
    expect(body.bookId).toBe(1);
    expect(body.memberId).toBe(7);
    expect(body.returnedAt).toBeNull();
    expect(Math.abs(Date.now() - new Date(body.borrowedAt).getTime())).toBeLessThan(5000);

    expect(vi.mocked(getBook)).toHaveBeenCalledWith(1);
    expect(vi.mocked(getMember)).toHaveBeenCalledWith(7);
    expect(vi.mocked(borrowCopy)).toHaveBeenCalledWith(1);

    const stored = findActiveLoan(1, 7);
    expect(stored).toBeDefined();
    const loan = stored as Loan;
    expect(loan.dueDate).toBe(new Date(new Date(loan.borrowedAt).getTime() + 14 * DAY_MS).toISOString());
  });

  it('forces the caller memberId for role member and ignores the body memberId', async () => {
    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1, memberId: 99 });

    expect(response.status).toBe(201);
    expect((response.body as LoanBody).memberId).toBe(7);
    expect(vi.mocked(getMember)).toHaveBeenCalledWith(7);
  });

  it('rejects role member without x-user-member-id with 403 and creates no loan', async () => {
    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5))
      .send({ bookId: 1 });

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error).toBe('No member id for this caller');
    expect(vi.mocked(getBook)).not.toHaveBeenCalled();
    expect(vi.mocked(borrowCopy)).not.toHaveBeenCalled();
    expect(findLoanById(1)).toBeUndefined();
  });

  it('requires memberId in the body for a librarian', async () => {
    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('librarian', 1))
      .send({ bookId: 1 });

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error).toBe('memberId is required');
    expect(vi.mocked(getBook)).not.toHaveBeenCalled();
  });

  it('uses the body memberId for a librarian', async () => {
    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('librarian', 1))
      .send({ bookId: 1, memberId: 7 });

    expect(response.status).toBe(201);
    expect((response.body as LoanBody).memberId).toBe(7);
    expect(vi.mocked(getMember)).toHaveBeenCalledWith(7);
  });

  it('propagates a 404 from catalog-service for an unknown book', async () => {
    vi.mocked(getBook).mockResolvedValue({ ok: false, status: 404, error: 'Book not found' });

    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 42 });

    expect(response.status).toBe(404);
    expect((response.body as ErrorBody).error).toBe('Book not found');
    expect(vi.mocked(getMember)).not.toHaveBeenCalled();
    expect(vi.mocked(borrowCopy)).not.toHaveBeenCalled();
    expect(findLoanById(1)).toBeUndefined();
  });

  it('propagates a 404 from member-service for an unknown member', async () => {
    vi.mocked(getMember).mockResolvedValue({ ok: false, status: 404, error: 'Member not found' });

    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1 });

    expect(response.status).toBe(404);
    expect((response.body as ErrorBody).error).toBe('Member not found');
    expect(vi.mocked(borrowCopy)).not.toHaveBeenCalled();
    expect(findLoanById(1)).toBeUndefined();
  });

  it('rejects a duplicate active loan for the same member and book', async () => {
    const first = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1 });

    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1 });

    expect(second.status).toBe(409);
    expect((second.body as ErrorBody).error).toBe(
      'This member already has an active loan for this book',
    );
    expect(vi.mocked(borrowCopy)).toHaveBeenCalledTimes(1);
  });

  it('rejects a fourth active loan for the same member', async () => {
    seedLoan(10, 7, daysFromNow(10));
    seedLoan(11, 7, daysFromNow(10));
    seedLoan(12, 7, daysFromNow(10));

    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1 });

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).error).toBe('A member may have at most 3 active loans');
    expect(vi.mocked(borrowCopy)).not.toHaveBeenCalled();
    expect(findActiveLoan(1, 7)).toBeUndefined();
  });

  it('does not count returned loans towards the three active loans limit', async () => {
    seedLoan(10, 7, daysFromNow(-10));
    seedLoan(11, 7, daysFromNow(-10));
    markReturned(1, new Date().toISOString());
    markReturned(2, new Date().toISOString());

    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1 });

    expect(response.status).toBe(201);
  });

  it('propagates a 409 from catalog-service and creates no loan', async () => {
    vi.mocked(borrowCopy).mockResolvedValue({ ok: false, status: 409, error: 'No copies available' });

    const response = await request(app)
      .post('/loans')
      .set(identityHeaders('member', 5, 7))
      .send({ bookId: 1 });

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).error).toBe('No copies available');
    expect(findActiveLoan(1, 7)).toBeUndefined();
  });
});

describe('POST /loans/:id/return', () => {
  it('responds 404 for an unknown loan', async () => {
    const response = await request(app)
      .post('/loans/42/return')
      .set(identityHeaders('librarian', 1));

    expect(response.status).toBe(404);
    expect((response.body as ErrorBody).error).toBe('Loan not found');
    expect(vi.mocked(returnCopy)).not.toHaveBeenCalled();
  });

  it('rejects a member who does not own the loan', async () => {
    seedLoan(1, 7, daysFromNow(10));

    const response = await request(app)
      .post('/loans/1/return')
      .set(identityHeaders('member', 8, 8));

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error).toBe('Not allowed to return this loan');
    expect(vi.mocked(returnCopy)).not.toHaveBeenCalled();
  });

  it('rejects a loan that was already returned', async () => {
    seedLoan(1, 7, daysFromNow(10));
    markReturned(1, new Date().toISOString());

    const response = await request(app)
      .post('/loans/1/return')
      .set(identityHeaders('librarian', 1));

    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).error).toBe('This loan has already been returned');
    expect(vi.mocked(returnCopy)).not.toHaveBeenCalled();
  });

  it('lets a librarian return a loan and responds 200 without dueDate', async () => {
    seedLoan(1, 7, daysFromNow(10));

    const response = await request(app)
      .post('/loans/1/return')
      .set(identityHeaders('librarian', 1));

    expect(response.status).toBe(200);

    const body = response.body as LoanBody;
    expect(Object.keys(body).sort()).toEqual([
      'bookId',
      'borrowedAt',
      'id',
      'memberId',
      'returnedAt',
    ]);
    expect(body).not.toHaveProperty('dueDate');
    expect(typeof body.returnedAt).toBe('string');
    expect(vi.mocked(returnCopy)).toHaveBeenCalledWith(1);

    const stored = findLoanById(1);
    expect(stored).toBeDefined();
    expect((stored as Loan).returnedAt).toBe(body.returnedAt);
  });

  it('lets the loan owner return their own loan', async () => {
    seedLoan(1, 7, daysFromNow(10));

    const response = await request(app)
      .post('/loans/1/return')
      .set(identityHeaders('member', 5, 7));

    expect(response.status).toBe(200);
    expect((response.body as LoanBody).returnedAt).not.toBeNull();
    expect(vi.mocked(returnCopy)).toHaveBeenCalledWith(1);
  });

  it('succeeds when catalog-service answers 404 for the book', async () => {
    seedLoan(1, 7, daysFromNow(10));
    vi.mocked(returnCopy).mockResolvedValue({ ok: false, status: 404, error: 'Book not found' });

    const response = await request(app)
      .post('/loans/1/return')
      .set(identityHeaders('librarian', 1));

    expect(response.status).toBe(200);
    expect((response.body as LoanBody).returnedAt).not.toBeNull();
  });

  it('propagates a non-404 failure from catalog-service without marking the loan returned', async () => {
    seedLoan(1, 7, daysFromNow(10));
    vi.mocked(returnCopy).mockResolvedValue({
      ok: false,
      status: 502,
      error: 'Catalog service unavailable',
    });

    const response = await request(app)
      .post('/loans/1/return')
      .set(identityHeaders('librarian', 1));

    expect(response.status).toBe(502);
    expect((response.body as ErrorBody).error).toBe('Catalog service unavailable');
    expect((findLoanById(1) as Loan).returnedAt).toBeNull();
  });
});

describe('GET /loans/overdue', () => {
  it('rejects a non-librarian', async () => {
    const response = await request(app)
      .get('/loans/overdue')
      .set(identityHeaders('member', 5, 7));

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error).toBe('Librarian role required');
  });

  it('requires the service key', async () => {
    const response = await request(app)
      .get('/loans/overdue')
      .set({ 'x-user-id': '1', 'x-user-role': 'librarian' });

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });

  it('returns only unreturned loans whose dueDate has passed, including dueDate', async () => {
    const pastDue = daysFromNow(-2);
    seedLoan(1, 7, pastDue);
    seedLoan(2, 8, daysFromNow(5));
    seedLoan(3, 9, daysFromNow(-3));
    markReturned(3, new Date().toISOString());

    const response = await request(app)
      .get('/loans/overdue')
      .set(identityHeaders('librarian', 1));

    expect(response.status).toBe(200);

    const body = response.body as Loan[];
    expect(body).toHaveLength(1);
    expect(body[0].bookId).toBe(1);
    expect(body[0].memberId).toBe(7);
    expect(body[0].dueDate).toBe(pastDue);
  });

  it('returns an empty array when nothing is overdue', async () => {
    seedLoan(1, 7, daysFromNow(5));

    const response = await request(app)
      .get('/loans/overdue')
      .set(identityHeaders('librarian', 1));

    expect(response.status).toBe(200);
    expect(response.body as Loan[]).toEqual([]);
  });
});
