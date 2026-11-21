// Generic Thai messages for login. Never says which of email or password was wrong (Requirement 3.5).
export const LOGIN_EXPIRED_MESSAGE = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';

export function loginErrorMessage(status: number): string {
  if (status === 401) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (status === 429) return 'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (status === 400) return 'กรุณากรอกอีเมลและรหัสผ่านให้ถูกต้อง';
  if (status === 0) return 'เชื่อมต่อไม่ได้ กรุณาลองใหม่';
  return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่';
}
