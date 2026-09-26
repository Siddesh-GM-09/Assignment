import type { ApiErrorBody } from '../types';

const defaultApiUrl = import.meta.env.PROD ? '/api' : 'http://localhost:3001/api';
const API = import.meta.env.VITE_API_URL ?? defaultApiUrl;

export class ApiError extends Error {
  code?: string;
  alternatives?: ApiErrorBody['alternatives'];

  constructor(message: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.code = body?.code;
    this.alternatives = body?.alternatives;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(body.error?.message ?? 'We could not complete that request. Please try again.', body.error);
  }

  return body.data as T;
}
