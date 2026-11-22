import type { ReactNode } from 'react';

// Nine small cartoon scenes, one per pitch slide. Pure SVG + CSS keyframes (globals.css, classes pa-*), no libraries.
// They restart when the slide changes because the deck keys each scene by its slide.
const W = 400;
const H = 220;
const E = ({ x, y, size = 36, children, className = '' }: { x: number; y: number; size?: number; children: string; className?: string }) => (
  <text x={x} y={y} fontSize={size} textAnchor="middle" className={`pa-box ${className}`}>{children}</text>
);
const Label = ({ x, y, children }: { x: number; y: number; children: ReactNode }) => (
  <text x={x} y={y} fontSize="12" textAnchor="middle" fill="#334155" fontWeight="600">{children}</text>
);
const Sky = ({ from, to, ground }: { from: string; to: string; ground: string }) => (
  <>
    <defs><linearGradient id={`g-${from.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
    <rect width={W} height={H} rx="18" fill={`url(#g-${from.slice(1)})`} />
    <path d={`M0 170 Q100 155 200 168 T400 165 V${H} H0Z`} fill={ground} />
  </>
);

function Burn() {
  return (
    <>
      <Sky from="#fde68a" to="#fed7aa" ground="#a16207" />
      <circle cx="340" cy="46" r="24" fill="#fbbf24" className="pa-pulse pa-box" />
      {[90, 160, 230].map((x, i) => (
        <g key={x}>
          <rect x={x - 22} y="160" width="44" height="22" rx="10" fill="#eab308" />
          <path d={`M${x - 14} 160 Q${x - 6} 128 ${x} 138 Q${x + 4} 120 ${x + 10} 142 Q${x + 18} 148 ${x + 14} 160Z`} fill="#f97316" className="pa-flicker" style={{ animationDelay: `${i * 0.2}s` }} />
          <path d={`M${x - 6} 160 Q${x} 142 ${x + 4} 150 Q${x + 8} 156 ${x + 6} 160Z`} fill="#fde047" className="pa-flicker" />
        </g>
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={95 + i * 28} cy="132" r="14" fill="#64748b" className="pa-rise pa-box" style={{ animationDelay: `${i * 0.5}s` }} />
      ))}
      <E x={300} y={120} className="pa-bob">😷</E>
      <Label x={200} y={207}>เผา = ถูกที่สุด แต่ควันเป็นต้นทางของ PM 2.5</Label>
    </>
  );
}

function Scattered() {
  const plots = [[60, 130], [150, 105], [250, 145], [330, 110], [200, 175]];
  return (
    <>
      <Sky from="#bbf7d0" to="#dcfce7" ground="#86efac" />
      {plots.map(([x, y], i) => (
        <g key={i}><rect x={x! - 24} y={y! - 14} width="48" height="28" rx="6" fill="#facc15" opacity=".8" /><E x={x!} y={y! + 7} size={20} className="pa-sway">🌾</E></g>
      ))}
      <path d="M40 60 C120 20 220 90 360 40" stroke="#94a3b8" strokeWidth="2" fill="none" className="pa-flow" />
      <g className="pa-roam" style={{ transform: 'translate(0,0)' }}><E x={40} y={75} size={34}>🚛</E></g>
      <E x={340} y={45} size={22} className="pa-bob">⛽</E>
      <E x={120} y={50} size={22} className="pa-pulse">❓</E>
      <Label x={200} y={208}>แปลงเล็กกระจาย ผู้รวบรวมต้องตระเวนหาเอง</Label>
    </>
  );
}

function Match() {
  return (
    <>
      <Sky from="#dbeafe" to="#ecfeff" ground="#bbf7d0" />
      <line x1="75" y1="110" x2="190" y2="110" stroke="#16a34a" strokeWidth="3" className="pa-flow" />
      <line x1="210" y1="110" x2="325" y2="110" stroke="#16a34a" strokeWidth="3" className="pa-flow" />
      <E x={60} y={125} size={42}>🚜</E>
      <E x={60} y={72} size={26} className="pa-bob">📍</E>
      <circle cx="200" cy="110" r="34" fill="#fff" stroke="#16a34a" strokeWidth="3" className="pa-pulse pa-box" />
      <E x={200} y={124} size={36}>🤖</E>
      <circle cx="200" cy="110" r="48" fill="none" stroke="#86efac" strokeDasharray="3 8" strokeWidth="3" className="pa-spin pa-box" />
      <g className="pa-drive"><E x={0} y={132} size={38}>🚛</E></g>
      <E x={340} y={125} size={36}>🧱</E>
      <Label x={60} y={160}>โพสต์พิกัด</Label><Label x={200} y={178}>AI Match</Label><Label x={340} y={160}>อัดก้อน</Label>
    </>
  );
}

function Carbon() {
  return (
    <>
      <Sky from="#e0f2fe" to="#f0fdf4" ground="#d9f99d" />
      {[0, 1, 2].map((i) => <line key={i} x1={70 + i * 100} y1="110" x2={130 + i * 100} y2="110" stroke="#0f766e" strokeWidth="3" className="pa-flow" />)}
      <E x={45} y={125} size={36}>🧱</E><E x={150} y={125} size={44}>🏭</E><E x={250} y={125} size={36} className="pa-bob">🏷️</E><E x={350} y={125} size={40}>⚡</E>
      <circle cx="165" cy="70" r="9" fill="#cbd5e1" className="pa-rise pa-box" />
      <circle cx="175" cy="70" r="7" fill="#cbd5e1" className="pa-rise pa-box" style={{ animationDelay: '1s' }} />
      <Label x={45} y={160}>เศษอัดก้อน</Label><Label x={150} y={165}>โรงอัดชีวมวล</Label><Label x={250} y={160}>หลักฐานคาร์บอน</Label><Label x={350} y={160}>ปลายน้ำ</Label>
      <text x="200" y="205" textAnchor="middle" fontSize="11" fill="#b45309" fontWeight="700">ต้องผ่านการตรวจสอบ T-VER / TGO ก่อนได้เครดิต</text>
    </>
  );
}

function Cycle() {
  const nodes = [['⚡', 'ปลายน้ำซื้อ'], ['🏭', 'โรงอัดต้องการเศษ'], ['🚜', 'ชาวนาขายเศษ'], ['🌾', 'เผาน้อยลง'], ['🌬️', 'PM 2.5 ลด']];
  return (
    <>
      <Sky from="#ecfccb" to="#f0fdfa" ground="#bef264" />
      <circle cx="200" cy="105" r="72" fill="none" stroke="#16a34a" strokeWidth="3" strokeDasharray="4 10" className="pa-spin pa-box" />
      {nodes.map(([icon, text], i) => {
        const a = (-90 + i * 72) * (Math.PI / 180);
        const x = 200 + 72 * Math.cos(a), y = 105 + 72 * Math.sin(a);
        return <g key={text}><circle cx={x} cy={y} r="22" fill="#fff" stroke="#16a34a" strokeWidth="2" className="pa-pulse pa-box" style={{ animationDelay: `${i * 0.35}s` }} /><E x={x} y={y + 8} size={22}>{icon!}</E><Label x={x} y={y + (y > 105 ? 38 : -28)}>{text!}</Label></g>;
      })}
      <E x={200} y={118} size={34} className="pa-sway">🌱</E>
    </>
  );
}

function Plant() {
  return (
    <>
      <Sky from="#fef3c7" to="#ecfccb" ground="#d4d4d8" />
      <rect x="30" y="95" width="260" height="6" fill="#94a3b8" />
      <g className="pa-drive" style={{ animationDuration: '5s' }}><E x={0} y={92} size={34}>🚛</E><rect x="-18" y="60" width="26" height="14" rx="5" fill="#eab308" opacity=".7" /></g>
      <E x={340} y={110} size={54}>🏭</E>
      <text x="85" y="150" textAnchor="middle" fontSize="12" fontWeight="700" fill="#b45309">หลวม 6 ตัน/เที่ยว</text>
      <rect x="55" y="156" width="60" height="30" rx="4" fill="#fde68a" /><rect x="55" y="156" width="60" height="30" rx="4" fill="#ef4444" className="pa-grow" style={{ transformOrigin: '0 50%' }} />
      <text x="85" y="176" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">167 ฿/ตัน</text>
      <text x="225" y="150" textAnchor="middle" fontSize="12" fontWeight="700" fill="#15803d">อัดก้อน 15 ตัน/เที่ยว</text>
      <rect x="195" y="156" width="60" height="30" rx="4" fill="#bbf7d0" /><rect x="195" y="156" width="26" height="30" rx="4" fill="#16a34a" className="pa-grow" />
      <text x="225" y="176" textAnchor="middle" fontSize="12" fontWeight="700" fill="#064e3b">67 ฿/ตัน</text>
      <text x="200" y="208" textAnchor="middle" fontSize="11" fill="#64748b">ระยะ 20 กม. (คำนวณจากสูตร ไม่ใช่ข้อมูลจริง)</text>
    </>
  );
}

function Formula() {
  const bars: [string, number, string, string][] = [['เผาที่เลี่ยงได้', 0.145, '#f97316', '+0.145'], ['แทนถ่านหิน', 0.66, '#64748b', '+0.66'], ['ปล่อยจากโครงการ', 0.05, '#ef4444', '−0.05'], ['หักเผื่อ 20%', 0.15, '#a78bfa', '−20%']];
  return (
    <>
      <Sky from="#f0f9ff" to="#f0fdf4" ground="#e2e8f0" />
      {bars.map(([label, v, color, txt], i) => {
        const h = Math.max(10, v * 120);
        const x = 40 + i * 70;
        return <g key={label}><rect x={x} y={170 - h} width="46" height={h} rx="5" fill={color} className="pa-grow" style={{ animationDelay: `${i * 0.5}s` }} /><text x={x + 23} y={165 - h} textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{txt}</text><text x={x + 23} y="188" textAnchor="middle" fontSize="10" fill="#475569">{label}</text></g>;
      })}
      <rect x="318" y="62" width="62" height="108" rx="6" fill="#16a34a" className="pa-grow" style={{ animationDelay: '2.2s' }} />
      <text x="349" y="56" textAnchor="middle" fontSize="13" fontWeight="800" fill="#166534">≈ 0.61</text>
      <text x="349" y="188" textAnchor="middle" fontSize="10" fill="#475569">tCO₂e/ตัน</text>
      <E x={349} y={110} size={26} className="pa-bob">🌍</E>
      <text x="200" y="210" textAnchor="middle" fontSize="11" fill="#b45309" fontWeight="700">Q และ s เป็นสมมติฐาน</text>
    </>
  );
}

function Money() {
  return (
    <>
      <Sky from="#fef9c3" to="#ecfccb" ground="#fde68a" />
      <text x="110" y="40" textAnchor="middle" fontSize="12" fontWeight="700" fill="#b45309">ก่อน (สมมติ)</text>
      <E x={110} y={110} size={40}>🔥</E><text x="110" y="150" textAnchor="middle" fontSize="20" fontWeight="800" fill="#b91c1c">0 บาท</text>
      <text x="290" y="40" textAnchor="middle" fontSize="12" fontWeight="700" fill="#15803d">หลัง (สมมติ)</text>
      {[0, 1, 2, 3].map((i) => <E key={i} x={262 + i * 18} y={80} size={22} className="pa-fall" >🪙</E>)}
      <E x={290} y={140} size={46}>💰</E><text x="290" y="168" textAnchor="middle" fontSize="20" fontWeight="800" fill="#166534">7,000 บาท/รอบ</text>
      <text x="200" y="200" textAnchor="middle" fontSize="11" fill="#475569">10 ตัน × 700 บาท/ตัน</text>
    </>
  );
}

function Next() {
  const steps = ['🧭', '🧪', '📋', '🔍', '🏷️'];
  return (
    <>
      <Sky from="#dcfce7" to="#f0f9ff" ground="#bbf7d0" />
      <path d="M40 150 H360" stroke="#16a34a" strokeWidth="4" strokeDasharray="6 8" className="pa-flow" />
      {steps.map((s, i) => (
        <g key={s}><circle cx={50 + i * 75} cy="150" r="20" fill="#fff" stroke="#16a34a" strokeWidth="3" className="pa-light" style={{ animationDelay: `${i * 1.2}s` }} /><E x={50 + i * 75} y={158} size={20}>{s}</E><text x={50 + i * 75} y="190" textAnchor="middle" fontSize="11" fill="#334155" fontWeight="600">{i + 1}</text></g>
      ))}
      <g className="pa-walk" style={{ transform: 'translateX(0)' }}><E x={50} y={110} size={34} className="pa-bob">🌱</E></g>
      <Label x={200} y={40}>จากแนวคิด สู่โครงการนำร่องที่นครสวรรค์</Label>
    </>
  );
}

const SCENES = [Burn, Scattered, Match, Carbon, Cycle, Plant, Formula, Money, Next];
const ALT = [
  'ภาพการ์ตูน: กองเศษพืชถูกเผา ควันลอยขึ้น', 'ภาพการ์ตูน: แปลงเล็กกระจาย รถบรรทุกวนหา', 'ภาพการ์ตูน: เกษตรกร AI และรถบรรทุกเชื่อมกัน',
  'ภาพการ์ตูน: เศษอัดก้อนไปโรงอัด แล้วไปปลายน้ำ', 'ภาพการ์ตูน: วงจรตลาดหมุนต่อเนื่อง', 'ภาพการ์ตูน: เทียบค่าขนส่งเศษหลวมกับอัดก้อน',
  'ภาพการ์ตูน: แท่งสูตรคาร์บอนรวมเป็นผลลัพธ์', 'ภาพการ์ตูน: รายได้ก่อนและหลังมีแอป', 'ภาพการ์ตูน: ขั้นตอนไปสู่โครงการนำร่อง',
];

export function PitchScene({ index }: { index: number }) {
  const Scene = SCENES[index];
  if (!Scene) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ALT[index]} data-testid="scene" className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
      <Scene />
    </svg>
  );
}
export const SCENE_COUNT = SCENES.length;
