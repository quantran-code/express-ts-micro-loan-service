import { config } from '../config';
import type { DownstreamResult } from './catalogClient';

export interface Member {
  id: number;
  name: string;
  email: string;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // The downstream service did not answer with a JSON body; fall through to the default.
  }

  return 'Member service error';
}

export async function getMember(memberId: number): Promise<DownstreamResult<Member>> {
  try {
    const response = await fetch(`${config.memberServiceUrl}/internal/members/${memberId}`, {
      method: 'GET',
      headers: { 'x-service-key': config.serviceKey },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: await readErrorMessage(response) };
    }

    const data = (await response.json()) as Member;
    return { ok: true, data };
  } catch {
    return { ok: false, status: 502, error: 'Member service unavailable' };
  }
}
