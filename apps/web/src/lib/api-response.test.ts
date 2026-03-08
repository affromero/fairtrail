import { describe, it, expect } from 'vitest';
import { apiSuccess, apiError } from './api-response';

describe('apiSuccess', () => {
  it('returns ok true with data', async () => {
    const res = apiSuccess({ flights: 3 });
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { flights: 3 } });
  });

  it('defaults to status 200', () => {
    const res = apiSuccess('anything');
    expect(res.status).toBe(200);
  });

  it('allows custom status', () => {
    const res = apiSuccess({ id: '1' }, 201);
    expect(res.status).toBe(201);
  });
});

describe('apiError', () => {
  it('returns ok false with error message', async () => {
    const res = apiError('Something went wrong');
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'Something went wrong' });
  });

  it('defaults to status 400', () => {
    const res = apiError('bad request');
    expect(res.status).toBe(400);
  });

  it('allows custom status', () => {
    const res = apiError('not found', 404);
    expect(res.status).toBe(404);
  });
});
