// Stable error codes (design.md "Error Handling"). Messages are Thai, short, and never carry secrets,
// message text or contact data. The HTTP edge maps `status`; the LINE edge sends `messageTh`.
export const ERROR_TABLE = {
  UNAUTHENTICATED: { status: 401, messageTh: 'กรุณาเข้าสู่ระบบ' },
  CSRF: { status: 403, messageTh: 'คำขอไม่ถูกต้อง' },
  FORBIDDEN: { status: 403, messageTh: 'คุณไม่มีสิทธิ์ทำรายการนี้' },
  NOT_FOUND: { status: 404, messageTh: 'ไม่พบข้อมูล' },
  VALIDATION: { status: 422, messageTh: 'ข้อมูลไม่ถูกต้อง' },
  STALE_VERSION: { status: 409, messageTh: 'ข้อมูลมีการเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง' },
  INVALID_STATE: { status: 409, messageTh: 'สถานะปัจจุบันไม่รองรับรายการนี้' },
  OFFER_EXPIRED: { status: 409, messageTh: 'ข้อเสนอหมดอายุแล้ว' },
  INSUFFICIENT_QUANTITY: { status: 409, messageTh: 'ปริมาณคงเหลือไม่พอ' },
  ALLOCATION_EXCEEDED: { status: 409, messageTh: 'จัดสรรเกินปริมาณที่ซื้อมา' },
  IDEMPOTENCY_MISMATCH: { status: 422, messageTh: 'รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว' },
  CONFLICT_RETRY: { status: 503, messageTh: 'ระบบไม่ว่าง กรุณาลองใหม่อีกครั้ง' },
  STORAGE_UNAVAILABLE: { status: 503, messageTh: 'ที่เก็บรูปภาพไม่พร้อมใช้งาน' },
  INTERNAL: { status: 500, messageTh: 'เกิดข้อผิดพลาดของระบบ' },
} as const;

export type ErrorCode = keyof typeof ERROR_TABLE;
export const ERROR_CODES = Object.keys(ERROR_TABLE) as ErrorCode[];

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export interface AppError {
  readonly code: ErrorCode;
  /** Invalid fields for VALIDATION only. */
  readonly fields?: readonly FieldIssue[];
  /** Safe extra data the client may see (e.g. current version or state). Never contact data. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export function appError(
  code: ErrorCode,
  extra: { fields?: readonly FieldIssue[]; details?: Readonly<Record<string, unknown>> } = {},
): AppError {
  return { code, ...extra };
}

export const httpStatusOf = (e: AppError): number => ERROR_TABLE[e.code].status;
export const messageThOf = (e: AppError): string => ERROR_TABLE[e.code].messageTh;
