'use client';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

// Nine small cartoon scenes, one per pitch slide. Pure SVG + CSS keyframes (globals.css, classes pa-*), no libraries.
// They restart when the slide changes because the deck keys each scene by its slide.
/** Story clock: 0..n-1 one step every `ms`, then a short rest, then it starts over. */
function useStep(n: number, ms = 1700): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setStep(n - 1); return; }
    const t = setInterval(() => setStep((s) => (s + 1) % (n + 2)), ms);
    return () => clearInterval(t);
  }, [n, ms]);
  return Math.min(step, n - 1);
}
/** Fade and slide in once the story reaches step `from`. */
const at = (step: number, from: number, dy = 10): CSSProperties => ({
  opacity: step >= from ? 1 : 0, transform: step >= from ? 'none' : `translateY(${dy}px)`, transition: 'opacity .55s ease, transform .55s cubic-bezier(.2,.9,.3,1.3)',
});
/** Cartoon speech bubble. `tx` is where the tail points. */
function Bubble({ x, y, w = 150, text, step, from, tail = 0 }: { x: number; y: number; w?: number; text: string; step: number; from: number; tail?: number }) {
  return (
    <g style={at(step, from, 6)} aria-hidden="true">
      <rect x={x - w / 2} y={y - 22} width={w} height="30" rx="14" fill="#fff" stroke="#334155" strokeWidth="1.5" />
      <path d={`M${x + tail - 6} ${y + 7} l6 12 l6 -12`} fill="#fff" stroke="#334155" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x={x + tail - 5} y={y + 5} width="10" height="4" fill="#fff" />
      <text x={x} y={y - 3} fontSize="11.5" fontWeight="700" textAnchor="middle" fill="#0f172a">{text}</text>
    </g>
  );
}
const Clouds = () => (
  <g opacity=".85">
    <g className="pa-cloud"><ellipse cx="40" cy="30" rx="26" ry="9" fill="#fff" /><ellipse cx="56" cy="24" rx="16" ry="9" fill="#fff" /></g>
    <g className="pa-cloud-slow" style={{ animationDelay: '-18s' }}><ellipse cx="40" cy="58" rx="22" ry="7" fill="#fff" /><ellipse cx="52" cy="53" rx="13" ry="7" fill="#fff" /></g>
  </g>
);

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
    <Clouds />
    <path d={`M0 170 Q100 155 200 168 T400 165 V${H} H0Z`} fill={ground} />
  </>
);

function Burn() {
  const st = useStep(4);
  return (
    <>
      <Sky from="#fde68a" to="#fed7aa" ground="#a16207" />
      <circle cx="340" cy="46" r="24" fill="#fbbf24" className="pa-pulse pa-box" />
      {[90, 160, 230].map((x, i) => (
        <g key={x}>
          <rect x={x - 22} y="160" width="44" height="22" rx="10" fill="#eab308" />
          <g style={at(st, 2, 0)}>
            <path d={`M${x - 14} 160 Q${x - 6} 128 ${x} 138 Q${x + 4} 120 ${x + 10} 142 Q${x + 18} 148 ${x + 14} 160Z`} fill="#f97316" className="pa-flicker" style={{ animationDelay: `${i * 0.2}s` }} />
            <path d={`M${x - 6} 160 Q${x} 142 ${x + 4} 150 Q${x + 8} 156 ${x + 6} 160Z`} fill="#fde047" className="pa-flicker" />
          </g>
        </g>
      ))}
      <g style={{ opacity: st >= 2 ? 1 : 0, transition: 'opacity .6s' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={95 + i * 28} cy="132" r="14" fill="#64748b" className="pa-rise pa-box" style={{ animationDelay: `${i * 0.5}s` }} />)}
      </g>
      <g className="pa-walkin" key="farmer"><E x={36} y={165} size={40}>🧑‍🌾</E></g>
      <E x={310} y={150} size={34} className="pa-bob" >{st >= 3 ? '😷' : '😊'}</E>
      <Bubble x={90} y={95} w={170} step={st} from={1} text="ไม่มีทางเลือกอื่นแล้ว…" tail={-40} />
      <Bubble x={300} y={105} w={120} step={st} from={3} text="แค่ก ๆ PM 2.5!" tail={10} />
      <Label x={200} y={207}>เผา = ถูกที่สุด แต่ควันเป็นต้นทางของฝุ่น</Label>
    </>
  );
}

function Scattered() {
  const st = useStep(4);
  const plots = [[60, 130], [150, 105], [250, 145], [330, 110], [200, 175]];
  return (
    <>
      <Sky from="#bbf7d0" to="#dcfce7" ground="#86efac" />
      {plots.map(([x, y], i) => (
        <g key={i} style={at(st, 0, 0)}><rect x={x! - 24} y={y! - 14} width="48" height="28" rx="6" fill="#facc15" opacity=".8" /><E x={x!} y={y! + 7} size={20} className="pa-sway">🌾</E></g>
      ))}
      <path d="M40 60 C120 20 220 90 360 40" stroke="#94a3b8" strokeWidth="2" fill="none" className="pa-flow" />
      <g className="pa-roam"><E x={40} y={75} size={34}>🚛</E></g>
      <E x={340} y={45} size={22} className="pa-bob">⛽</E>
      <Bubble x={120} y={40} w={160} step={st} from={1} text="แปลงไหนดีนะ…?" tail={-30} />
      <Bubble x={300} y={185} w={190} step={st} from={2} text="น้ำมันหมดไปกับการหา" tail={20} />
      <Bubble x={90} y={195} w={150} step={st} from={3} text="รายเล็กไม่มีใครรับ" tail={-30} />
    </>
  );
}

function Match() {
  const st = useStep(4);
  return (
    <>
      <Sky from="#dbeafe" to="#ecfeff" ground="#bbf7d0" />
      <line x1="75" y1="120" x2="165" y2="120" stroke="#16a34a" strokeWidth="3" className="pa-flow" style={{ opacity: st >= 1 ? 1 : 0.15 }} />
      <line x1="235" y1="120" x2="325" y2="120" stroke="#16a34a" strokeWidth="3" className="pa-flow" style={{ opacity: st >= 2 ? 1 : 0.15 }} />
      <g className="pa-walkin"><E x={60} y={140} size={42}>🚜</E></g>
      <E x={60} y={92} size={26} className="pa-bob">📍</E>
      <circle cx="200" cy="120" r="34" fill="#fff" stroke="#16a34a" strokeWidth="3" className="pa-pulse pa-box" />
      <E x={200} y={134} size={36} className="pa-hop">🤖</E>
      <circle cx="200" cy="120" r="48" fill="none" stroke="#86efac" strokeDasharray="3 8" strokeWidth="3" className="pa-spin pa-box" />
      <g style={{ transform: st >= 2 ? 'translateX(0)' : 'translateX(120px)', opacity: st >= 2 ? 1 : 0, transition: 'transform 1.2s ease-out, opacity .5s' }}><E x={340} y={142} size={38}>🚛</E></g>
      <g style={at(st, 3, 0)}><E x={340} y={100} size={30} className="pa-bob">🧱</E></g>
      <Bubble x={75} y={52} w={130} step={st} from={0} text="มีฟาง 10 ตัน!" tail={-10} />
      <Bubble x={200} y={48} w={120} step={st} from={1} text="จับคู่ได้แล้ว!" tail={0} />
      <Bubble x={325} y={60} w={110} step={st} from={2} text="ไปรับเลย!" tail={10} />
      <Label x={200} y={207}>เกษตรกรโพสต์ → AI จับคู่ → ผู้รวบรวมรับ → อัดก้อน</Label>
    </>
  );
}

function Carbon() {
  const st = useStep(4);
  return (
    <>
      <Sky from="#e0f2fe" to="#f0fdf4" ground="#d9f99d" />
      {[0, 1, 2].map((i) => <line key={i} x1={70 + i * 100} y1="120" x2={130 + i * 100} y2="120" stroke="#0f766e" strokeWidth="3" className="pa-flow" style={{ opacity: st >= i ? 1 : 0.15 }} />)}
      <E x={45} y={135} size={36}>🧱</E><E x={150} y={135} size={44} className="pa-hop">🏭</E>
      <g style={at(st, 1, 0)}><E x={250} y={135} size={36} className="pa-bob">🏷️</E></g>
      <g style={at(st, 2, 0)}><E x={350} y={135} size={40} className="pa-pulse">⚡</E></g>
      <circle cx="165" cy="80" r="9" fill="#cbd5e1" className="pa-rise pa-box" /><circle cx="175" cy="80" r="7" fill="#cbd5e1" className="pa-rise pa-box" style={{ animationDelay: '1s' }} />
      <Bubble x={150} y={55} w={160} step={st} from={0} text="ทำไมต้องซื้อแพงกว่า?" tail={0} />
      <Bubble x={290} y={90} w={150} step={st} from={2} text="มีหลักฐานคาร์บอนนะ" tail={50} />
      <text x="200" y="205" textAnchor="middle" fontSize="11" fill="#b45309" fontWeight="700" style={{ opacity: st >= 3 ? 1 : 0.4, transition: 'opacity .5s' }}>ต้องผ่านการตรวจสอบ T-VER / TGO ก่อนได้เครดิต</text>
    </>
  );
}

function Cycle() {
  const st = useStep(5, 1300);
  const nodes = [['⚡', 'ปลายน้ำซื้อ'], ['🏭', 'โรงอัดต้องการเศษ'], ['🚜', 'ชาวนาขายเศษ'], ['🌾', 'เผาน้อยลง'], ['🌬️', 'PM 2.5 ลด']];
  return (
    <>
      <Sky from="#ecfccb" to="#f0fdfa" ground="#bef264" />
      <circle cx="200" cy="105" r="72" fill="none" stroke="#16a34a" strokeWidth="3" strokeDasharray="4 10" className="pa-spin pa-box" />
      {nodes.map(([icon, text], i) => {
        const a = (-90 + i * 72) * (Math.PI / 180);
        const x = 200 + 72 * Math.cos(a), y = 105 + 72 * Math.sin(a);
        const on = st >= i;
        return (
          <g key={text} style={{ opacity: on ? 1 : 0.25, transition: 'opacity .5s' }}>
            <circle cx={x} cy={y} r={on && st === i ? 26 : 22} fill={on && st === i ? '#dcfce7' : '#fff'} stroke="#16a34a" strokeWidth="2" style={{ transition: 'all .4s' }} />
            <E x={x} y={y + 8} size={22} className={st === i ? 'pa-hop' : ''}>{icon!}</E><Label x={x} y={y + (y > 105 ? 38 : -30)}>{text!}</Label>
          </g>
        );
      })}
      <E x={200} y={120} size={st >= 4 ? 46 : 32} className="pa-sway">🌱</E>
    </>
  );
}

function Plant() {
  const st = useStep(4);
  return (
    <>
      <Sky from="#fef3c7" to="#ecfccb" ground="#d4d4d8" />
      <rect x="30" y="95" width="260" height="6" fill="#94a3b8" />
      <g className="pa-drive" style={{ animationDuration: '5s' }}><E x={0} y={92} size={34}>🚛</E><rect x="-18" y="60" width="26" height="14" rx="5" fill="#eab308" opacity=".7" /></g>
      <E x={340} y={110} size={54} className="pa-hop">🏭</E>
      <g style={at(st, 1, 0)}>
        <text x="85" y="150" textAnchor="middle" fontSize="12" fontWeight="700" fill="#b45309">หลวม 6 ตัน/เที่ยว</text>
        <rect x="55" y="156" width="60" height="30" rx="4" fill="#fde68a" /><rect x="55" y="156" width="60" height="30" rx="4" fill="#ef4444" className="pa-grow" style={{ transformOrigin: '0 50%' }} />
        <text x="85" y="176" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">167 ฿/ตัน</text>
      </g>
      <g style={at(st, 2, 0)}>
        <text x="225" y="150" textAnchor="middle" fontSize="12" fontWeight="700" fill="#15803d">อัดก้อน 15 ตัน/เที่ยว</text>
        <rect x="195" y="156" width="60" height="30" rx="4" fill="#bbf7d0" /><rect x="195" y="156" width="26" height="30" rx="4" fill="#16a34a" className="pa-grow" />
        <text x="225" y="176" textAnchor="middle" fontSize="12" fontWeight="700" fill="#064e3b">67 ฿/ตัน</text>
      </g>
      <Bubble x={300} y={50} w={150} step={st} from={3} text="อัดก้อนก่อน ถูกลงเยอะ!" tail={30} />
      <text x="200" y="208" textAnchor="middle" fontSize="11" fill="#64748b">ระยะ 20 กม. (คำนวณจากสูตร ไม่ใช่ข้อมูลจริง)</text>
    </>
  );
}

function Formula() {
  const st = useStep(6, 1300);
  const bars: [string, number, string, string][] = [['เผาที่เลี่ยงได้', 0.145, '#f97316', '+0.145'], ['แทนถ่านหิน', 0.66, '#64748b', '+0.66'], ['ปล่อยจากโครงการ', 0.05, '#ef4444', '−0.05'], ['หักเผื่อ 20%', 0.15, '#a78bfa', '−20%']];
  return (
    <>
      <Sky from="#f0f9ff" to="#f0fdf4" ground="#e2e8f0" />
      {bars.map(([label, v, color, txt], i) => {
        const h = Math.max(10, v * 120);
        const x = 40 + i * 70;
        return <g key={label} style={at(st, i, 0)}><rect x={x} y={170 - h} width="46" height={h} rx="5" fill={color} className="pa-grow" /><text x={x + 23} y={165 - h} textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{txt}</text><text x={x + 23} y="188" textAnchor="middle" fontSize="10" fill="#475569">{label}</text></g>;
      })}
      <g style={at(st, 4, 0)}>
        <rect x="318" y="62" width="62" height="108" rx="6" fill="#16a34a" className="pa-grow" />
        <text x="349" y="56" textAnchor="middle" fontSize="13" fontWeight="800" fill="#166534">≈ 0.61</text>
        <text x="349" y="188" textAnchor="middle" fontSize="10" fill="#475569">tCO₂e/ตัน</text>
      </g>
      <g style={at(st, 5, 0)}><E x={349} y={110} size={30} className="pa-bob">🌍</E></g>
      <Bubble x={170} y={40} w={170} step={st} from={5} text="รวม ≈ 7,265 tCO₂e/ปี" tail={40} />
      <text x="200" y="210" textAnchor="middle" fontSize="11" fill="#b45309" fontWeight="700">Q และ s เป็นสมมติฐาน</text>
    </>
  );
}

function Money() {
  const st = useStep(4);
  return (
    <>
      <Sky from="#fef9c3" to="#ecfccb" ground="#fde68a" />
      <text x="110" y="40" textAnchor="middle" fontSize="12" fontWeight="700" fill="#b45309">ก่อน (สมมติ)</text>
      <E x={110} y={110} size={40} className="pa-flicker">🔥</E><text x="110" y="150" textAnchor="middle" fontSize="20" fontWeight="800" fill="#b91c1c">0 บาท</text>
      <text x="290" y="40" textAnchor="middle" fontSize="12" fontWeight="700" fill="#15803d" style={at(st, 1, 0)}>หลัง (สมมติ)</text>
      <g style={{ opacity: st >= 1 ? 1 : 0, transition: 'opacity .4s' }}>{[0, 1, 2, 3].map((i) => <E key={i} x={262 + i * 18} y={80} size={22} className="pa-fall">🪙</E>)}</g>
      <g style={at(st, 1, 0)}><E x={290} y={140} size={46} className="pa-hop">💰</E></g>
      <text x="290" y="168" textAnchor="middle" fontSize="20" fontWeight="800" fill="#166534" style={at(st, 2, 0)}>7,000 บาท/รอบ</text>
      <g className="pa-walkin" key="f"><E x={190} y={150} size={34}>🧑‍🌾</E></g>
      <Bubble x={190} y={95} w={110} step={st} from={3} text="ได้เงินแล้ว!" tail={0} />
      <text x="200" y="200" textAnchor="middle" fontSize="11" fill="#475569">10 ตัน × 700 บาท/ตัน</text>
    </>
  );
}

function Next() {
  const st = useStep(6, 1200);
  const steps = ['🧭', '🧪', '📋', '🔍', '🏷️'];
  return (
    <>
      <Sky from="#dcfce7" to="#f0f9ff" ground="#bbf7d0" />
      <path d="M40 150 H360" stroke="#16a34a" strokeWidth="4" strokeDasharray="6 8" className="pa-flow" />
      {steps.map((s, i) => (
        <g key={s} style={{ opacity: st >= i ? 1 : 0.3, transition: 'opacity .5s' }}>
          <circle cx={50 + i * 75} cy="150" r={st === i ? 24 : 20} fill={st >= i ? '#dcfce7' : '#fff'} stroke="#16a34a" strokeWidth="3" style={{ transition: 'all .4s' }} />
          <E x={50 + i * 75} y={158} size={20}>{s}</E><text x={50 + i * 75} y="190" textAnchor="middle" fontSize="11" fill="#334155" fontWeight="600">{i + 1}</text>
        </g>
      ))}
      <g style={{ transform: `translateX(${Math.min(st, 4) * 75}px)`, transition: 'transform 1s ease-in-out' }}><E x={50} y={112} size={34} className="pa-hop">🌱</E></g>
      <Bubble x={200} y={52} w={230} step={st} from={4} text="เริ่มจากนครสวรรค์ ก้าวทีละขั้น" tail={0} />
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
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ALT[index]} data-testid="scene" className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
      <Scene />
    </svg>
  );
}
export const SCENE_COUNT = SCENES.length;
