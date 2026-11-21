import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
// OWASP minimum for argon2id (19 MiB, 2 passes, 1 lane). Verification reads the parameters from the hash itself.
const PARAMS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (password: string): Promise<string> => argon2.hash(password, PARAMS);
let dummy: Promise<string> | undefined;
/** A valid hash of a random value, made with the same parameters as real hashes. */
const dummyHash = (): Promise<string> => (dummy ??= argon2.hash(`dummy-${randomBytes(16).toString('hex')}`, PARAMS));
/**
 * Verify `password` against `hash`. When there is no hash (unknown email, or a user without a password)
 * a dummy hash is verified instead so the response time does not reveal whether the account exists.
 * Always resolves false for the dummy.
 */
export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    await argon2.verify(await dummyHash(), password).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // malformed stored hash counts as a failed login
  }
}
