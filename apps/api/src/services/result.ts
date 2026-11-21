// Typed result for service functions. Services never throw for expected failures; the edge maps the error.
import type { AppError } from './errors.js';

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E = AppError> = { readonly ok: false; readonly error: E };
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Transform the value of an Ok; an Err passes through. */
export function mapResult<T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}
