export interface Loan {
  id: number;
  bookId: number;
  memberId: number;
  borrowedAt: string;
  returnedAt: string | null;
  dueDate: string;
}

export interface CreateLoanInput {
  bookId: number;
  memberId: number;
  borrowedAt: string;
  dueDate: string;
}

const loans: Loan[] = [];
let nextId = 1;

export function createLoan(input: CreateLoanInput): Loan {
  const loan: Loan = {
    id: nextId,
    bookId: input.bookId,
    memberId: input.memberId,
    borrowedAt: input.borrowedAt,
    returnedAt: null,
    dueDate: input.dueDate,
  };

  nextId += 1;
  loans.push(loan);
  return loan;
}

export function findLoanById(id: number): Loan | undefined {
  return loans.find((loan) => loan.id === id);
}

export function findActiveLoan(bookId: number, memberId: number): Loan | undefined {
  return loans.find(
    (loan) => loan.bookId === bookId && loan.memberId === memberId && loan.returnedAt === null,
  );
}

export function countActiveLoans(memberId: number): number {
  return loans.filter((loan) => loan.memberId === memberId && loan.returnedAt === null).length;
}

export function markReturned(id: number, returnedAt: string): Loan | undefined {
  const loan = findLoanById(id);
  if (!loan) {
    return undefined;
  }

  loan.returnedAt = returnedAt;
  return loan;
}

export function listOverdueLoans(now: string): readonly Loan[] {
  const nowTime = new Date(now).getTime();

  return loans.filter(
    (loan) => loan.returnedAt === null && new Date(loan.dueDate).getTime() < nowTime,
  );
}

export function resetLoans(): void {
  loans.length = 0;
  nextId = 1;
}
