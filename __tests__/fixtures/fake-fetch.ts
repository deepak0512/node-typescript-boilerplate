import { vi, type Mock } from 'vitest';
import type { FetchLike } from '../../src/doc-sync/types.js';

export interface FakeResponseInit {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Final URL after redirects; synthetic Responses otherwise have an empty `url`. */
  readonly url?: string;
}

export function jsonResponse(
  body: unknown,
  { status = 200, headers = {}, url }: FakeResponseInit = {},
): Response {
  return textResponse(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    ...(url === undefined ? {} : { url }),
  });
}

export function textResponse(
  text: string,
  { status = 200, headers = {}, url }: FakeResponseInit = {},
): Response {
  const response = new Response(text, { status, headers });
  if (url !== undefined) {
    Object.defineProperty(response, 'url', { value: url });
  }
  return response;
}

/** A `fetch` that answers every call with a fresh Response from `respond`. */
export function fakeFetch(
  respond: () => Response | Promise<Response>,
): Mock<FetchLike> {
  return vi.fn<FetchLike>(async () => respond());
}

/** A `fetch` that always rejects with `error`. */
export function failingFetch(error: unknown): Mock<FetchLike> {
  return vi.fn<FetchLike>(async () => {
    throw error;
  });
}
