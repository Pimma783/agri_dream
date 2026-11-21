import { z } from 'zod';
// Enum value lists shared by repository row schemas. They mirror the CHECK constraints in db/migrations.
export const materialType = z.enum(['RICE_STRAW', 'CANE_LEAF', 'CORN_COB', 'OTHER']);
export const materialForm = z.enum(['LOOSE', 'BALED']);
export const priceMode = z.enum(['FIXED', 'NEGOTIABLE']);
export const priceUnit = z.enum(['KG', 'TON']);
export const priceUnitBale = z.enum(['KG', 'TON', 'BALE']);
export const transportBy = z.enum(['SELLER', 'BUYER', 'EITHER', 'UNKNOWN']);
export const publishStatus = z.enum(['PUBLISHED', 'PAUSED', 'CLOSED', 'CANCELLED']);
export const lineChannel = z.enum(['farmer', 'baler', 'factory']);
