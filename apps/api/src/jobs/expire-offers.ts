import type { OfferService } from '../services/index.js';
import type { Sweeper } from './sweepers.js';

/** `expire_offers`: every minute, PENDING offers past `expires_at` become EXPIRED (Requirement 11.7). Safe to run on several workers. */
export function createExpireOffersSweeper(offers: Pick<OfferService, 'expireDue'>, intervalMs = 60_000): Sweeper {
  return { name: 'expire_offers', intervalMs, run: (now) => offers.expireDue(now) };
}
