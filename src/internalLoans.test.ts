import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import app from './app';
import { config } from './config';
import { createLoan, markReturned, resetLoans } from './repositories/loanRepository';
import type { Loan } from './repositories/loanRepository';

interface CountBody {
  count: number;
}

interface ErrorBody {
  error: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function serviceKeyHeaders(): Record<string, string> {
  return { 'x-service-key': config.serviceKey };
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
});

describe('GET /internal/loans/active-count', () => {
  it('rejects a request without x-service-key', async () => {
    const response = await request(app).get('/internal/loans/active-count?memberId=7');

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });

  it('rejects a request with the wrong x-service-key', async () => {
    const response = await request(app)
      .get('/internal/loans/active-count?memberId=7')
      .set({ 'x-service-key': 'wrong-key' });

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });

  it('rejects a request without memberId', async () => {
    const response = await request(app)
      .get('/internal/loans/active-count')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error).toBe('memberId is required');
  });

  it('rejects a memberId that is not a positive integer', async () => {
    const response = await request(app)
      .get('/internal/loans/active-count?memberId=abc')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error).toBe('memberId is required');
  });

  it('counts only the unreturned loans of that member', async () => {
    seedLoan(1, 7, daysFromNow(10));
    seedLoan(2, 7, daysFromNow(10));
    seedLoan(3, 7, daysFromNow(-10));
    seedLoan(4, 8, daysFromNow(10));
    markReturned(3, new Date().toISOString());

    const response = await request(app)
      .get('/internal/loans/active-count?memberId=7')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(200);
    expect(response.body as CountBody).toEqual({ count: 2 });
  });

  it('responds 0 for a member with no loans', async () => {
    seedLoan(1, 7, daysFromNow(10));

    const response = await request(app)
      .get('/internal/loans/active-count?memberId=42')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(200);
    expect(response.body as CountBody).toEqual({ count: 0 });
  });
});

describe('GET /internal/loans', () => {
  it('rejects a request without x-service-key', async () => {
    const response = await request(app).get('/internal/loans?memberId=7&status=active');

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });

  it('rejects a request without memberId', async () => {
    const response = await request(app).get('/internal/loans?status=active').set(serviceKeyHeaders());

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error).toBe('memberId is required');
  });

  it('rejects a status that is neither active nor returned', async () => {
    const response = await request(app)
      .get('/internal/loans?memberId=7&status=pending')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error).toBe('status must be active or returned');
  });

  it('returns only the unreturned loans of that member, including dueDate', async () => {
    const activeDue = daysFromNow(10);
    seedLoan(1, 7, activeDue);
    seedLoan(2, 8, daysFromNow(10));
    seedLoan(3, 7, daysFromNow(-2));
    markReturned(3, new Date().toISOString());

    const response = await request(app)
      .get('/internal/loans?memberId=7&status=active')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(200);

    const body = response.body as Loan[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(1);
    expect(body[0].bookId).toBe(1);
    expect(body[0].memberId).toBe(7);
    expect(body[0].borrowedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body[0].returnedAt).toBeNull();
    expect(body[0].dueDate).toBe(activeDue);
  });

  it('returns only the returned loans of that member', async () => {
    seedLoan(1, 7, daysFromNow(10));
    seedLoan(2, 7, daysFromNow(10));
    seedLoan(3, 8, daysFromNow(10));
    const returnedAt = new Date().toISOString();
    markReturned(2, returnedAt);
    markReturned(3, returnedAt);

    const response = await request(app)
      .get('/internal/loans?memberId=7&status=returned')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(200);

    const body = response.body as Loan[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(2);
    expect(body[0].memberId).toBe(7);
    expect(body[0].returnedAt).toBe(returnedAt);
    expect(body[0].dueDate).toBeDefined();
  });

  it('returns every loan of that member when status is absent', async () => {
    seedLoan(1, 7, daysFromNow(10));
    seedLoan(2, 7, daysFromNow(10));
    seedLoan(3, 8, daysFromNow(10));
    markReturned(2, new Date().toISOString());

    const response = await request(app)
      .get('/internal/loans?memberId=7')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(200);

    const body = response.body as Loan[];
    expect(body).toHaveLength(2);
    expect(body.map((loan) => loan.id).sort()).toEqual([1, 2]);
    expect(body.every((loan) => loan.memberId === 7)).toBe(true);
  });

  it('returns an empty array for a member without loans', async () => {
    seedLoan(1, 7, daysFromNow(10));

    const response = await request(app)
      .get('/internal/loans?memberId=42&status=active')
      .set(serviceKeyHeaders());

    expect(response.status).toBe(200);
    expect(response.body as Loan[]).toEqual([]);
  });

  it('does not change the /loans routes, which still require caller identity', async () => {
    const response = await request(app).get('/loans/overdue').set(serviceKeyHeaders());

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid user identity');
  });

  it('returns every loan, returned and unreturned, when no filter is given', async () => {
    const activeDue = daysFromNow(10);
    seedLoan(1, 7, activeDue);
    seedLoan(2, 8, daysFromNow(5));
    const returnedAt = new Date().toISOString();
    markReturned(2, returnedAt);

    const response = await request(app).get('/internal/loans').set(serviceKeyHeaders());

    expect(response.status).toBe(200);

    const body = response.body as Loan[];
    expect(body).toHaveLength(2);
    expect(body.map((loan) => loan.id)).toEqual([1, 2]);
    expect(body[0].bookId).toBe(1);
    expect(body[0].memberId).toBe(7);
    expect(body[0].borrowedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body[0].returnedAt).toBeNull();
    expect(body[0].dueDate).toBe(activeDue);
    expect(body[1].returnedAt).toBe(returnedAt);
    expect(body[1].dueDate).toBeDefined();
  });

  it('returns an empty array when no loan exists at all', async () => {
    const response = await request(app).get('/internal/loans').set(serviceKeyHeaders());

    expect(response.status).toBe(200);
    expect(response.body as Loan[]).toEqual([]);
  });

  it('rejects an unfiltered request without x-service-key', async () => {
    const response = await request(app).get('/internal/loans');

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });
});

describe('GET /internal/loans/overdue', () => {
  it('rejects a request without x-service-key', async () => {
    const response = await request(app).get('/internal/loans/overdue');

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });

  it('rejects a request with the wrong x-service-key', async () => {
    const response = await request(app)
      .get('/internal/loans/overdue')
      .set({ 'x-service-key': 'wrong-key' });

    expect(response.status).toBe(401);
    expect((response.body as ErrorBody).error).toBe('Invalid service key');
  });

  it('returns only unreturned loans whose dueDate has passed, including dueDate', async () => {
    const pastDue = daysFromNow(-2);
    seedLoan(1, 7, pastDue);
    seedLoan(2, 8, daysFromNow(5));
    seedLoan(3, 9, daysFromNow(-3));
    markReturned(3, new Date().toISOString());

    const response = await request(app).get('/internal/loans/overdue').set(serviceKeyHeaders());

    expect(response.status).toBe(200);

    const body = response.body as Loan[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(1);
    expect(body[0].bookId).toBe(1);
    expect(body[0].memberId).toBe(7);
    expect(body[0].borrowedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body[0].returnedAt).toBeNull();
    expect(body[0].dueDate).toBe(pastDue);
  });

  it('returns an empty array when nothing is overdue', async () => {
    seedLoan(1, 7, daysFromNow(5));

    const response = await request(app).get('/internal/loans/overdue').set(serviceKeyHeaders());

    expect(response.status).toBe(200);
    expect(response.body as Loan[]).toEqual([]);
  });
});
