import { config } from '../config';

export interface CatalogBook {
  id: number;
  title: string;
  author: string;
  isbn: string;
  totalCopies: number;
  availableCopies: number;
}

export type DownstreamResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // The downstream service did not answer with a JSON body; fall through to the default.
  }

  return 'Catalog service error';
}

async function requestCatalog<T>(
  path: string,
  method: 'GET' | 'POST',
): Promise<DownstreamResult<T>> {
  try {
    const response = await fetch(`${config.catalogServiceUrl}${path}`, {
      method,
      headers: { 'x-service-key': config.serviceKey },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: await readErrorMessage(response) };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, status: 502, error: 'Catalog service unavailable' };
  }
}

export function getBook(bookId: number): Promise<DownstreamResult<CatalogBook>> {
  return requestCatalog<CatalogBook>(`/internal/books/${bookId}`, 'GET');
}

export function borrowCopy(bookId: number): Promise<DownstreamResult<CatalogBook>> {
  return requestCatalog<CatalogBook>(`/internal/books/${bookId}/borrow`, 'POST');
}

export function returnCopy(bookId: number): Promise<DownstreamResult<CatalogBook>> {
  return requestCatalog<CatalogBook>(`/internal/books/${bookId}/return`, 'POST');
}
