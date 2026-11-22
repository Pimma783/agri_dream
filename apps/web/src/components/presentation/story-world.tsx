'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { activeness, cameraAt, progressFromScroll, zoneX } from '@/lib/story-camera';

// Low-poly 3D world behind the scroll story. One zone per section along the X axis; scrolling moves the camera
// between shots (lib/story-camera.ts) and grows or fades each zone's props. Built from primitives, no model files.

const C = {
  grass: 0x9bd770, field: 0xd9b44a, straw: 0xeab308, fire: 0xf97316, flame: 0xfde047, smoke: 0x6b7280,
  truck: 0x2563eb, truck2: 0x16a34a, wheel: 0x1f2937, factory: 0xcbd5e1, roof: 0x64748b, green: 0x16a34a,
  ai: 0x22c55e, pin: 0xef4444, coin: 0xfacc15, tag: 0xf59e0b, purple: 0xa78bfa, red: 0xef4444, white: 0xffffff,
};
const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

function box(w: number, h: number, d: number, color: number, m?: Partial<THREE.MeshStandardMaterialParameters>) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, m));
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function cyl(rt: number, rb: number, h: number, color: number, seg = 8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  mesh.castShadow = true;
  return mesh;
}
function truck(color: number): THREE.Group {
  const g = new THREE.Group();
  const cab = box(1.6, 1.4, 1.8, color); cab.position.set(1.6, 1.1, 0);
  const bed = box(2.8, 0.5, 1.9, 0x94a3b8); bed.position.set(-0.4, 0.75, 0);
  g.add(cab, bed);
  for (const [x, z] of [[1.6, 1], [1.6, -1], [-1.2, 1], [-1.2, -1]] as const) {
    const w = cyl(0.42, 0.42, 0.3, C.wheel, 10); w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w);
  }
  return g;
}
function factory(): THREE.Group {
  const g = new THREE.Group();
  const hall = box(7, 3.6, 5, C.factory); hall.position.y = 1.8;
  const roof = box(7.2, 0.4, 5.2, C.roof); roof.position.y = 3.8;
  g.add(hall, roof);
  for (const x of [-2, 0.4]) { const ch = cyl(0.45, 0.6, 5, C.roof); ch.position.set(x, 5.5, -1.2); g.add(ch); }
  return g;
}
function tree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = cyl(0.18, 0.25, 1.2, 0x8b5a2b, 6); trunk.position.y = 0.6;
  const top = new THREE.Mesh(new THREE.ConeGeometry(1, 2.2, 7), mat(0x15803d)); top.position.y = 2.1; top.castShadow = true;
  g.add(trunk, top);
  return g;
}
function dashed(points: THREE.Vector3[], color: number): THREE.Line {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4 }));
  line.computeLineDistances();
  return line;
}

interface Zone { update: (t: number, a: number) => void }

function buildWorld(scene: THREE.Scene): Zone[] {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 160), mat(C.grass));
  ground.rotation.x = -Math.PI / 2; ground.position.x = zoneX(4); ground.receiveShadow = true;
  scene.add(ground);
  // Trees and a dirt road tie the zones into one landscape.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(zoneX(8) + 60, 3), mat(0xc2a878));
  road.rotation.x = -Math.PI / 2; road.position.set(zoneX(4), 0.02, 9); road.receiveShadow = true; scene.add(road);
  for (let i = 0; i < 70; i++) {
    const t = tree(); const side = i % 2 ? 1 : -1;
    t.position.set(-20 + i * 5.3 + Math.sin(i) * 2, 0, side * (16 + (i % 5) * 3)); t.scale.setScalar(0.8 + (i % 3) * 0.25); scene.add(t);
  }
  const zones: Zone[] = [];

  // 1 Burning field: straw piles, flames, smoke.
  {
    const g = new THREE.Group(); g.position.x = zoneX(0); scene.add(g);
    const field = box(18, 0.1, 12, C.field); field.position.y = 0.05; g.add(field);
    const flames: THREE.Mesh[] = []; const smoke: THREE.Mesh[] = [];
    [-5, 0, 5].forEach((x, i) => {
      const pile = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 8), mat(C.straw)); pile.position.set(x, 1, i - 1); pile.castShadow = true; g.add(pile);
      const f = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 6), mat(C.fire, { emissive: C.fire, emissiveIntensity: 0.8 })); f.position.set(x, 2.6, i - 1); g.add(f); flames.push(f);
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.6, 7, 6), mat(C.smoke, { transparent: true, opacity: 0.6 }));
        s.position.set(x, 4, i - 1); s.userData.phase = k / 4; g.add(s); smoke.push(s);
      }
    });
    zones.push({ update: (t, a) => {
      flames.forEach((f, i) => { const k = 0.85 + Math.sin(t * 9 + i) * 0.15; f.scale.set(k, k * (1 + Math.sin(t * 13 + i) * 0.12), k); });
      smoke.forEach((s, i) => {
        const ph = (t * 0.25 + (s.userData.phase as number) + i * 0.07) % 1;
        s.position.y = 3.6 + ph * 8; s.position.x = (s.userData.x0 ??= s.position.x) + Math.sin(ph * 6 + i) * 0.6; s.scale.setScalar(0.5 + ph * 1.6);
        (s.material as THREE.MeshStandardMaterial).opacity = (1 - ph) * 0.65 * Math.max(0.35, a);
      });
    } });
  }

  // 2 Scattered plots: small fields far apart, one truck wandering between them.
  {
    const g = new THREE.Group(); g.position.x = zoneX(1); scene.add(g);
    const spots: [number, number][] = [[-10, -6], [-3, 5], [6, -4], [11, 6], [1, -10]];
    spots.forEach(([x, z]) => { const p = box(4, 0.15, 3, C.field); p.position.set(x, 0.08, z); g.add(p); const pile = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1, 6), mat(C.straw)); pile.position.set(x, 0.6, z); g.add(pile); });
    const curve = new THREE.CatmullRomCurve3(spots.map(([x, z]) => new THREE.Vector3(x, 0, z + 2)), true);
    g.add(dashed(curve.getPoints(80).map((v) => v.setY(0.1)), 0x64748b));
    const tr = truck(C.truck); tr.scale.setScalar(0.8); g.add(tr);
    zones.push({ update: (t) => {
      const u = (t * 0.04) % 1; const p = curve.getPointAt(u); const n = curve.getPointAt((u + 0.01) % 1);
      tr.position.copy(p); tr.lookAt(n); tr.rotateY(-Math.PI / 2);
    } });
  }

  // 3 AI match: farmer pin, glowing hub, truck coming in.
  {
    const g = new THREE.Group(); g.position.x = zoneX(2); scene.add(g);
    const pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 10), mat(C.pin)); head.position.y = 3;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 10), mat(C.pin)); tip.position.y = 1.9; tip.rotation.x = Math.PI;
    pin.add(head, tip); pin.position.set(-9, 0, 0); g.add(pin);
    const hub = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), mat(C.ai, { emissive: C.ai, emissiveIntensity: 0.5 })); hub.position.y = 3.2; g.add(hub);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.1, 8, 40), mat(0x86efac, { emissive: 0x86efac, emissiveIntensity: 0.6 })); ring.position.y = 3.2; g.add(ring);
    g.add(dashed([new THREE.Vector3(-9, 0.2, 0), new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(10, 0.2, 0)], C.green));
    const bales: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) { const b = box(1.2, 0.9, 0.9, C.straw); b.position.set(-9 + i * 1.3 - 1.3, 0.45, 2.2); g.add(b); bales.push(b); }
    const tr = truck(C.truck2); g.add(tr);
    zones.push({ update: (t, a) => {
      pin.position.y = Math.sin(t * 3) * 0.3;
      hub.rotation.y = t * 0.9; hub.rotation.x = t * 0.4; ring.rotation.x = Math.PI / 2 + Math.sin(t) * 0.3; ring.rotation.z = t;
      tr.position.set(12 - a * 18, 0, 0); tr.rotation.y = Math.PI;
      bales.forEach((b, i) => b.scale.setScalar(Math.min(1, Math.max(0.01, a * 1.6 - i * 0.2))));
    } });
  }

  // 4 Supply chain: bales -> biomass plant -> carbon tag -> power plant, packets flowing.
  {
    const g = new THREE.Group(); g.position.x = zoneX(3); scene.add(g);
    for (let i = 0; i < 4; i++) { const b = box(1.4, 1, 1, C.straw); b.position.set(-10, 0.5 + Math.floor(i / 2), (i % 2) * 1.1 - 0.5); g.add(b); }
    const f = factory(); f.position.x = -2; f.scale.setScalar(0.8); g.add(f);
    const tag = box(1.8, 1.2, 0.2, C.tag, { emissive: C.tag, emissiveIntensity: 0.3 }); tag.position.set(5, 2.5, 0); g.add(tag);
    const plant = new THREE.Group();
    for (const x of [-1, 1.4]) { const tower = cyl(1, 1.4, 5, 0xe2e8f0, 12); tower.position.set(x, 2.5, 0); plant.add(tower); }
    plant.position.x = 11; g.add(plant);
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-10, 1, 0), new THREE.Vector3(-2, 2, 0), new THREE.Vector3(5, 2.5, 0), new THREE.Vector3(11, 3, 0)]);
    const packets = Array.from({ length: 6 }, () => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(C.green, { emissive: C.green, emissiveIntensity: 0.6 })); g.add(s); return s; });
    zones.push({ update: (t) => {
      tag.rotation.y = t * 1.5;
      packets.forEach((s, i) => s.position.copy(path.getPointAt((t * 0.12 + i / packets.length) % 1)));
    } });
  }

  // 5 Market cycle: ring of five nodes orbiting a seedling that grows.
  {
    const g = new THREE.Group(); g.position.x = zoneX(4); scene.add(g);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.15, 8, 64), mat(C.green, { emissive: C.green, emissiveIntensity: 0.3 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.4; g.add(ring);
    const colors = [C.coin, C.factory, C.truck, C.straw, 0x7dd3fc];
    const nodes = colors.map((c) => { const n = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mat(c)); n.castShadow = true; g.add(n); return n; });
    const sprout = new THREE.Group();
    const stem = cyl(0.15, 0.2, 2, C.green, 6); stem.position.y = 1;
    const leafA = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), mat(0x4ade80)); leafA.scale.set(1.4, 0.4, 0.8); leafA.position.set(0.7, 2, 0);
    const leafB = leafA.clone(); leafB.position.x = -0.7;
    sprout.add(stem, leafA, leafB); g.add(sprout);
    zones.push({ update: (t, a) => {
      nodes.forEach((n, i) => { const ang = t * 0.5 + (i / nodes.length) * Math.PI * 2; n.position.set(Math.cos(ang) * 7, 1.2 + Math.sin(t * 2 + i) * 0.3, Math.sin(ang) * 7); n.rotation.y = t; });
      sprout.scale.setScalar(0.4 + a * 1.4); sprout.rotation.y = Math.sin(t) * 0.2;
    } });
  }

  // 6 Real plant: big factory, a loose-straw truck and a baled truck, cost columns 167 vs 67.
  {
    const g = new THREE.Group(); g.position.x = zoneX(5); scene.add(g);
    const f = factory(); f.position.set(6, 0, -3); g.add(f);
    const loose = truck(C.red); const looseLoad = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1, 6), mat(C.straw)); looseLoad.position.set(-0.4, 1.5, 0); loose.add(looseLoad); g.add(loose);
    const baled = truck(C.truck2); for (let i = 0; i < 4; i++) { const b = box(0.8, 0.6, 0.8, C.straw); b.position.set(-1.3 + (i % 2) * 0.9, 1.3 + Math.floor(i / 2) * 0.6, 0); baled.add(b); } g.add(baled);
    const colLoose = box(1.6, 1, 1.6, C.red); const colBale = box(1.6, 1, 1.6, C.green); colLoose.position.set(-8, 0, 4); colBale.position.set(-5, 0, 4); g.add(colLoose, colBale);
    zones.push({ update: (t, a) => {
      loose.position.set(-12 + ((t * 2) % 18), 0, 7); baled.position.set(-12 + ((t * 2 + 9) % 18), 0, 10.5);
      const h1 = Math.max(0.01, a * 6.7), h2 = Math.max(0.01, a * 2.7);
      colLoose.scale.y = h1; colLoose.position.y = h1 / 2; colBale.scale.y = h2; colBale.position.y = h2 / 2;
    } });
  }

  // 7 Formula: four term columns then the green result column.
  {
    const g = new THREE.Group(); g.position.x = zoneX(6); scene.add(g);
    const terms: [number, number][] = [[0.145, C.fire], [0.66, 0x64748b], [0.05, C.red], [0.15, C.purple], [0.61, C.green]];
    const cols = terms.map(([, c], i) => { const m = box(1.8, 1, 1.8, c); m.position.set(-8 + i * 4, 0, 0); g.add(m); return m; });
    const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), mat(0x38bdf8)); g.add(globe);
    zones.push({ update: (t, a) => {
      cols.forEach((m, i) => { const grow = Math.min(1, Math.max(0, a * 1.8 - i * 0.18)); const h = Math.max(0.01, terms[i]![0] * 14 * grow); m.scale.y = h; m.position.y = h / 2; });
      const top = Math.max(0.01, 0.61 * 14 * Math.min(1, Math.max(0, a * 1.8 - 0.72)));
      globe.position.set(8, top + 1.6 + Math.sin(t * 2) * 0.3, 0); globe.rotation.y = t;
    } });
  }

  // 8 Money: a fire with nothing vs a coin stack that builds up.
  {
    const g = new THREE.Group(); g.position.x = zoneX(7); scene.add(g);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2, 6), mat(C.fire, { emissive: C.fire, emissiveIntensity: 0.6 })); fire.position.set(-5, 1, 0); g.add(fire);
    const coins = Array.from({ length: 14 }, (_, i) => { const c = cyl(1, 1, 0.3, C.coin, 16); c.position.set(4 + (i % 2) * 0.15, 0.15 + i * 0.32, (i % 3) * 0.1); g.add(c); return c; });
    const falling = cyl(1, 1, 0.3, C.coin, 16); g.add(falling);
    zones.push({ update: (t, a) => {
      fire.scale.setScalar(0.85 + Math.sin(t * 10) * 0.12);
      const shown = Math.round(a * coins.length);
      coins.forEach((c, i) => { c.visible = i < shown; });
      const ph = (t * 0.6) % 1; falling.position.set(4, 10 - ph * 6, 0); falling.rotation.x = t * 4; falling.visible = a > 0.3;
    } });
  }

  // 9 The road ahead: five milestones light up in turn, a sprout travels along.
  {
    const g = new THREE.Group(); g.position.x = zoneX(8); scene.add(g);
    const stones = Array.from({ length: 5 }, (_, i) => { const s = cyl(1.4, 1.6, 0.5, 0xe5e7eb, 16); s.position.set(-10 + i * 6, 0.25, 0); g.add(s); return s; });
    const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 7), mat(0x22c55e)); g.add(sprout);
    zones.push({ update: (t, a) => {
      const reach = a * 4.999;
      stones.forEach((s, i) => { const m = s.material as THREE.MeshStandardMaterial; const on = i <= reach; m.color.setHex(on ? 0x86efac : 0xe5e7eb); m.emissive.setHex(on ? 0x16a34a : 0x000000); m.emissiveIntensity = on ? 0.35 : 0; });
      sprout.position.set(-10 + reach * 6, 1.4 + Math.abs(Math.sin(t * 4)) * 0.6, 0);
    } });
  }
  return zones;
}

function hasWebGL(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** Fixed full-screen canvas. Reads window scroll; the parent page provides the tall scrolling sections. */
export function StoryWorld() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!hasWebGL()) { setFallback(true); return; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdff3ff);
    scene.fog = new THREE.Fog(0xdff3ff, 40, 120);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7aa35a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
    scene.add(sun, sun.target);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    const zones = buildWorld(scene);

    const resize = () => { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize();
    window.addEventListener('resize', resize);
    let mx = 0, my = 0;
    const onMove = (e: PointerEvent) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener('pointermove', onMove);

    const target = new THREE.Vector3(); const look = new THREE.Vector3(); const curLook = new THREE.Vector3();
    let shown = -1; let frame = 0; let first = true; const clock = new THREE.Clock();
    const tick = () => {
      const t = reduce ? 0 : clock.getElapsedTime();
      const p = progressFromScroll(window.scrollY, document.documentElement.scrollHeight - window.innerHeight);
      // Ease toward the scroll target so wheel steps glide instead of jumping.
      shown = shown < 0 || reduce ? p : shown + (p - shown) * 0.08;
      const shot = cameraAt(shown);
      target.set(shot.pos[0] + mx * 3, shot.pos[1] - my * 2, shot.pos[2]);
      look.set(...shot.look);
      if (first) { camera.position.copy(target); curLook.copy(look); first = false; }
      camera.position.lerp(target, reduce ? 1 : 0.12); curLook.lerp(look, reduce ? 1 : 0.12); camera.lookAt(curLook);
      sun.position.set(curLook.x + 20, 30, 20); sun.target.position.copy(curLook);
      zones.forEach((z, i) => z.update(t, activeness(shown, i)));
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize); window.removeEventListener('pointermove', onMove);
      scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
      renderer.dispose();
    };
  }, []);
  return fallback
    ? <div aria-hidden="true" className="fixed inset-0 -z-10 bg-gradient-to-b from-sky-100 to-lime-100" />
    : <canvas ref={ref} aria-hidden="true" data-testid="story-canvas" className="fixed inset-0 -z-10 h-full w-full" />;
}
