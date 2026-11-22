/** Static demo data for the factory portal (desktop UI). No API calls: matches the design mock. */
export interface Material {
  id: string; name: string; seller: string; province: string; price: number; unit: string;
  qty: number; moisture: number; tone: string; type: string; saved?: boolean;
}

export const MATERIALS: Material[] = [
  { id: 'm1', name: 'แกลบแห้ง คัดคุณภาพ', seller: 'โรงสีรุ่งเรือง', province: 'สุพรรณบุรี', price: 1500, unit: 'ตัน', qty: 20, moisture: 10, tone: 'from-amber-200 to-amber-500', type: 'แกลบ' },
  { id: 'm2', name: 'ซังข้าวโพดบด', seller: 'ไร่ข้าวโพดสุขใจ', province: 'นครสวรรค์', price: 1800, unit: 'ตัน', qty: 30, moisture: 12, tone: 'from-orange-200 to-orange-500', type: 'ซังข้าวโพด' },
  { id: 'm3', name: 'ฟางข้าวอัดก้อน', seller: 'กลุ่มอัดฟางบ้านนา', province: 'ชัยนาท', price: 1200, unit: 'ตัน', qty: 60, moisture: 15, tone: 'from-yellow-100 to-yellow-400', type: 'ฟางข้าว' },
  { id: 'm4', name: 'เศษไม้สับ เบญจพรรณ', seller: 'ลานไม้ท่าม่วง', province: 'กาญจนบุรี', price: 2100, unit: 'ตัน', qty: 40, moisture: 20, tone: 'from-stone-200 to-stone-500', type: 'เศษไม้' },
  { id: 'm5', name: 'กะลาปาล์มแห้ง', seller: 'เทพาปาล์มออยล์', province: 'สุราษฎร์ธานี', price: 2800, unit: 'ตัน', qty: 16, moisture: 8, tone: 'from-stone-600 to-stone-900', type: 'กะลาปาล์ม' },
  { id: 'm6', name: 'ชานอ้อยอัดเม็ด', seller: 'ไร่อ้อยทองสุข', province: 'สุพรรณบุรี', price: 1650, unit: 'ตัน', qty: 25, moisture: 11, tone: 'from-lime-200 to-lime-600', type: 'ชานอ้อย' },
];

export type OrderStatus = 'รอยืนยัน' | 'กำลังจัดส่ง' | 'สำเร็จ';
export interface Order {
  id: string; code: string; material: string; seller: string; qty: number; price: number;
  status: OrderStatus; date: string; from: string; tone: string;
}
export const ORDERS: Order[] = [
  { id: '024', code: 'SHP-6911-024', material: 'แกลบแห้ง คัดคุณภาพ', seller: 'โรงสีรุ่งเรือง', qty: 20, price: 1500, status: 'กำลังจัดส่ง', date: '18 พ.ย. 2569', from: 'สุพรรณบุรี', tone: 'from-amber-200 to-amber-500' },
  { id: '023', code: 'SHP-6911-023', material: 'กะลาปาล์มแห้ง', seller: 'เทพาปาล์มออยล์', qty: 16, price: 2800, status: 'รอยืนยัน', date: '19 พ.ย. 2569', from: 'สุราษฎร์ธานี', tone: 'from-stone-600 to-stone-900' },
  { id: '022', code: 'SHP-6911-022', material: 'เศษไม้สับ เบญจพรรณ', seller: 'ลานไม้ท่าม่วง', qty: 5, price: 2100, status: 'สำเร็จ', date: '17 พ.ย. 2569', from: 'สระบุรี', tone: 'from-stone-200 to-stone-500' },
];

export const MONTHS = ['มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.'];
export const MONTHLY = [180, 210, 195, 240, 275, 300];
export const baht = (n: number) => `฿${n.toLocaleString('en-US')}`;

export const THREADS = [
  { id: 1, name: 'โรงสีรุ่งเรือง', last: 'ส่งรูปแกลบล็อตล่าสุดให้แล้วครับ', time: '10:42', unread: 3 },
  { id: 2, name: 'เทพาปาล์มออยล์', last: 'ยืนยันราคา 2,800 บาท/ตัน', time: '09:15', unread: 0 },
  { id: 3, name: 'ลานไม้ท่าม่วง', last: 'รถออกจากลานแล้วค่ะ', time: 'เมื่อวาน', unread: 0 },
  { id: 4, name: 'ไร่อ้อยทองสุข', last: 'สนใจเสนอราคาชานอ้อยเพิ่ม', time: 'เมื่อวาน', unread: 0 },
  { id: 5, name: 'กลุ่มอัดฟางบ้านนา', last: 'ขอเลื่อนส่งเป็นวันพฤหัสนะคะ', time: '17 พ.ย.', unread: 0 },
];
