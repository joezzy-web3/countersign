// The Countersign hero: a procedurally modelled wax seal, rendered with three.js.
// Built into web/vendor/seal3d.js by `npm run build:seal` (esbuild, tree-shaken, minified).
//
// API: const seal = mountSeal(canvas); seal.stamp(); seal.setTone("sealed" | "impostor" | "revoked")

import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const TONES = {
  sealed: { wax: "#0e4636", sheen: "#5fd1a8", emblem: "check" },
  impostor: { wax: "#7d0c12", sheen: "#ff7a70", emblem: "cross" },
  revoked: { wax: "#3b3835", sheen: "#bdb6ad", emblem: "slash" },
};

// Deterministic pseudo-noise so the wax rim looks poured, not perfect.
function rimRadius(theta, r) {
  return (
    r *
    (1 +
      0.045 * Math.sin(5 * theta + 0.7) +
      0.03 * Math.sin(9 * theta + 2.1) +
      0.018 * Math.sin(17 * theta + 4.2) +
      0.05 * Math.max(0, Math.sin(3 * theta - 0.4)) ** 6) // one wax drip lobe
  );
}

function waxBody() {
  const shape = new Shape();
  const N = 220;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = rimRadius(t, 1.18);
    const x = Math.cos(t) * r;
    const y = Math.sin(t) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return new ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.16,
    bevelSegments: 12,
    curveSegments: 1,
  });
}

function stroke(points, width) {
  // A thick polyline as a closed shape (for the embossed emblem strokes).
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)];
    const o = points[Math.max(i - 1, 0)];
    const d = new Vector2(q.x - o.x, q.y - o.y).normalize();
    const n = new Vector2(-d.y, d.x).multiplyScalar(width / 2);
    left.push(new Vector2(p.x + n.x, p.y + n.y));
    right.push(new Vector2(p.x - n.x, p.y - n.y));
  }
  const s = new Shape();
  s.moveTo(left[0].x, left[0].y);
  left.slice(1).forEach((p) => s.lineTo(p.x, p.y));
  right.reverse().forEach((p) => s.lineTo(p.x, p.y));
  s.closePath();
  return s;
}

function emblemGeometry(kind) {
  const V = (x, y) => new Vector2(x, y);
  const shapes =
    kind === "check"
      ? [stroke([V(-0.34, 0.0), V(-0.1, -0.24), V(0.38, 0.28)], 0.13)]
      : kind === "cross"
        ? [stroke([V(-0.3, -0.3), V(0.3, 0.3)], 0.13), stroke([V(-0.3, 0.3), V(0.3, -0.3)], 0.13)]
        : [stroke([V(-0.36, -0.12), V(0.36, 0.12)], 0.12)];
  return new ExtrudeGeometry(shapes, {
    depth: 0.02,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.03,
    bevelSegments: 6,
  });
}

function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export function mountSeal(canvas, { reducedMotion = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return null; // no WebGL: the page keeps its static SVG seal
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 7.6);

  const key = new DirectionalLight("#ffe7c8", 2.2);
  key.position.set(-3, 4, 5);
  const rim = new DirectionalLight("#9fd9ff", 1.4);
  rim.position.set(4, -2, -3);
  scene.add(key, rim);

  const wax = new MeshPhysicalMaterial({
    color: new Color(TONES.sealed.wax),
    roughness: 0.46,
    metalness: 0.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: new Color(TONES.sealed.sheen),
  });

  const seal = new Group();
  const body = new Mesh(waxBody(), wax);
  body.position.z = -0.14;
  seal.add(body);

  // Pressed ring: a raised torus inside the rim, and a bead ring like a coin's milled edge.
  const ring = new Mesh(new TorusGeometry(0.78, 0.045, 18, 160), wax);
  ring.scale.z = 0.7;
  ring.position.z = 0.16;
  seal.add(ring);
  const bead = new SphereGeometry(0.032, 12, 10);
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    const b = new Mesh(bead, wax);
    b.position.set(Math.cos(t) * 0.94, Math.sin(t) * 0.94, 0.13);
    seal.add(b);
  }
  const inner = new Mesh(new TorusGeometry(0.6, 0.02, 12, 120), wax);
  inner.position.z = 0.15;
  seal.add(inner);

  const emblems = {};
  for (const kind of ["check", "cross", "slash"]) {
    const m = new Mesh(emblemGeometry(kind), wax);
    m.position.z = 0.14;
    m.visible = kind === "check";
    emblems[kind] = m;
    seal.add(m);
  }

  const shadow = new Mesh(
    new PlaneGeometry(3.4, 3.4),
    new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.position.set(0.12, -0.12, -0.6);
  scene.add(shadow);

  // Impact ripple
  const ripple = new Mesh(
    new TorusGeometry(1.2, 0.008, 8, 160),
    new MeshBasicMaterial({ color: "#e3c08a", transparent: true, opacity: 0 }),
  );
  ripple.position.z = -0.3;
  scene.add(ripple);
  scene.add(seal);

  // ---- state ----
  const pointer = { x: 0, y: 0 };
  const tilt = { x: -0.35, y: 0.25 };
  let stampAt = -1;
  let toneFrom = new Color(TONES.sealed.wax);
  let toneTo = new Color(TONES.sealed.wax);
  let toneAt = -1;
  let running = true;
  let visible = true;
  const t0 = performance.now();

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  window.addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  });
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  document.addEventListener("visibilitychange", () => (running = !document.hidden));

  function stamp() {
    stampAt = performance.now();
  }

  function setTone(name) {
    const tone = TONES[name] ?? TONES.sealed;
    toneFrom = wax.color.clone();
    toneTo = new Color(tone.wax);
    wax.sheenColor.set(tone.sheen);
    toneAt = performance.now();
    for (const [k, m] of Object.entries(emblems)) m.visible = k === tone.emblem;
    stamp();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running || !visible) return;
    const time = (now - t0) / 1000;

    // Idle: slow breathing plus a tilt that follows the pointer.
    const idle = reducedMotion ? 0 : 1;
    tilt.x += ((pointer.y * 0.35 - 0.28) - tilt.x) * 0.05;
    tilt.y += ((pointer.x * 0.5 + 0.22) - tilt.y) * 0.05;
    seal.rotation.x = tilt.x + Math.sin(time * 0.7) * 0.05 * idle;
    seal.rotation.y = tilt.y + Math.sin(time * 0.5) * 0.08 * idle;
    seal.position.y = Math.sin(time * 1.1) * 0.04 * idle;

    // Stamp: drop from above, squash on impact, settle, ripple out.
    let shake = 0;
    if (stampAt > 0) {
      const s = (now - stampAt) / 1000;
      const drop = clamp01(s / 0.42);
      const fall = drop * drop * drop; // accelerate into the paper
      seal.position.z = (1 - fall) * 1.4;
      const scale = 1 + (1 - fall) * 0.12;
      if (s > 0.42) {
        const k = clamp01((s - 0.42) / 0.5);
        const squash = (1 - easeOutBack(k)) * 0.22;
        seal.scale.set(1 + squash * 0.6, 1 + squash * 0.6, 1 - squash);
        shake = (1 - k) ** 2 * 0.06;
        const r = clamp01((s - 0.42) / 0.9);
        ripple.scale.setScalar(1 + r * 0.55);
        ripple.material.opacity = (1 - r) ** 2 * 0.55;
      } else {
        seal.scale.setScalar(scale);
        ripple.material.opacity = 0;
      }
      shadow.material.opacity = 0.25 + fall * 0.75;
      shadow.scale.setScalar(1.4 - fall * 0.4);
      if (s > 1.5) {
        stampAt = -1;
        ripple.material.opacity = 0;
        seal.scale.setScalar(1);
        seal.position.z = 0;
      }
    }
    if (toneAt > 0) {
      const k = clamp01((now - toneAt) / 600);
      wax.color.copy(toneFrom).lerp(toneTo, k);
      if (k >= 1) toneAt = -1;
    }
    camera.position.x = (Math.random() - 0.5) * shake;
    camera.position.y = (Math.random() - 0.5) * shake;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  if (!reducedMotion) stamp();

  return { stamp, setTone };
}
