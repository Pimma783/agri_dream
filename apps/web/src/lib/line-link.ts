import type { LineChannelName, Role } from '@agrimatch/contracts';

/** Each role has its own LINE Official Account. */
export const CHANNEL_OF_ROLE: Record<Role, LineChannelName> = { FARMER: 'farmer', BALER: 'baler', FACTORY: 'factory' };

export const CHANNEL_LABEL_TH: Record<LineChannelName, string> = {
  farmer: 'LINE เกษตรกร',
  baler: 'LINE ผู้อัดฟาง',
  factory: 'LINE โรงงาน',
};

export function linkErrorMessage(status: number): string {
  if (status === 403) return 'ไม่สามารถสร้างรหัสผูกบัญชีได้';
  if (status === 0) return 'เชื่อมต่อไม่ได้ กรุณาลองใหม่';
  return 'สร้างรหัสไม่สำเร็จ กรุณาลองใหม่';
}
