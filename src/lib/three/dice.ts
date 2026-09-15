import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/*
  The hero: two glass dice above a black chrome floor. Everything is built
  at runtime — no model, texture or HDR file. The environment the glass
  refracts and the chrome reflects is a small room of light panels rendered
  once through PMREM.

  Three rules from earlier glass work, all load-bearing here:
  - transmissive meshes are FrontSide only (DoubleSide renders opaque white);
  - the glass does not write depth and renders after its pips, or the pips
    inside it fail the depth test and vanish;
  - nothing inside the glass is itself transmissive (the transmission pass
    skips other transmissive meshes).
*/

export type DiceHandle = { dispose: () => void };

type Die = { group: THREE.Group; axis: THREE.Vector3; speed: number; base: THREE.Vector3; phase: number };

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, 1],
    [1, -1],
  ],
  3: [
    [-1, 1],
    [0, 0],
    [1, -1],
  ],
  4: [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ],
  5: [
    [-1, 1],
    [1, 1],
    [0, 0],
    [-1, -1],
    [1, -1],
  ],
  6: [
    [-1, 1],
    [1, 1],
    [-1, 0],
    [1, 0],
    [-1, -1],
    [1, -1],
  ],
};

/** Face normals in the order 1..6 with opposite faces summing to seven. */
const FACES: { n: number; normal: THREE.Vector3; up: THREE.Vector3 }[] = [
  { n: 1, normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  { n: 6, normal: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  { n: 2, normal: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  { n: 5, normal: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  { n: 3, normal: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  { n: 4, normal: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
];

function paintEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshBasicMaterial({ color: 0x050507, side: THREE.BackSide })));
  const panel = (w: number, h: number, intensity: number, x: number, y: number, z: number, color = 0xffffff) => {
    const material = new THREE.MeshBasicMaterial();
    material.color.set(color).multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  panel(8, 8, 7, -3, 9, 4); // key softbox, high and to the left
  panel(18, 0.6, 9, 0, 11, -2); // thin strip: the specular line on chrome and glass edges
  panel(14, 9, 1.6, 0, 2, 14); // sheet behind the camera so front faces read as material
  panel(6, 8, 2.4, 11, 3, 2); // right fill, cool
  panel(4, 8, 1.2, -11, 1, -3); // left fill, dim
  panel(30, 2.2, 3.2, 0, -1.2, -14, 0xe3132b); // red horizon band, low, behind the dice
  panel(30, 1.2, 1.0, 0, -0.6, 14, 0xe3132b); // faint red return from the front
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return target.texture;
}

/** White centre fading to black: the floor exists only under the dice. */
function fadeTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.3, "#909090");
    g.addColorStop(0.6, "#000000");
    g.addColorStop(1, "#000000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

function shadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.85)");
    g.addColorStop(0.45, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

function buildDie(glass: THREE.MeshPhysicalMaterial, pip: THREE.Material, size: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(size, size, size, 6, size * 0.13), glass);
  body.renderOrder = 2;
  const pipGeometry = new THREE.SphereGeometry(size * 0.085, 24, 16);
  const pipMeshes = new THREE.Group();
  const spacing = size * 0.27;
  for (const face of FACES) {
    const right = new THREE.Vector3().crossVectors(face.up, face.normal).normalize();
    for (const [u, v] of PIPS[face.n]) {
      const m = new THREE.Mesh(pipGeometry, pip);
      m.position
        .copy(face.normal)
        .multiplyScalar(size / 2 - size * 0.03)
        .addScaledVector(right, u * spacing)
        .addScaledVector(face.up, v * spacing);
      m.renderOrder = 1;
      pipMeshes.add(m);
    }
  }
  group.add(pipMeshes);
  group.add(body);
  return group;
}

export function mountDice(canvas: HTMLCanvasElement, onFirstFrame?: () => void): DiceHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.transmissionResolutionScale = 0.8;

  const scene = new THREE.Scene();
  const env = paintEnvironment(renderer);
  scene.environment = env;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 1.15, 6.4);
  camera.lookAt(0, -0.05, 0);

  const fade = fadeTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    // never darker than the page: the floor may only add reflections
    new THREE.MeshStandardMaterial({ color: 0x0b0b0e, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.0, transparent: true, alphaMap: fade, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.85;
  floor.renderOrder = 0;
  scene.add(floor);

  const clearGlass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1,
    thickness: 1.1,
    roughness: 0.11,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.3,
    attenuationColor: new THREE.Color(0xffc9c9),
    attenuationDistance: 1.4,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const smokedGlass = new THREE.MeshPhysicalMaterial({
    color: 0x2b2b31,
    transmission: 0.95,
    thickness: 1.2,
    roughness: 0.06,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.4,
    attenuationColor: new THREE.Color(0x0a0a0d),
    attenuationDistance: 0.9,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const redPip = new THREE.MeshStandardMaterial({ color: 0xe3132b, roughness: 0.32, metalness: 0.05, emissive: 0x5a0a13, emissiveIntensity: 0.55 });
  const chromePip = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 1, envMapIntensity: 1.4 });

  const shadowMap = shadowTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, opacity: 0.9 });

  const dice: Die[] = [];
  const addDie = (glass: THREE.MeshPhysicalMaterial, pip: THREE.Material, size: number, base: THREE.Vector3, axis: THREE.Vector3, speed: number, phase: number) => {
    const group = buildDie(glass, pip, size);
    group.position.copy(base);
    scene.add(group);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size * 2.6, size * 2.6), shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(base.x, floor.position.y + 0.002, base.z);
    scene.add(shadow);
    dice.push({ group, axis: axis.normalize(), speed, base, phase });
  };
  addDie(clearGlass, redPip, 1.15, new THREE.Vector3(-0.95, 0.12, 0.1), new THREE.Vector3(0.6, 1, 0.35), 0.22, 0);
  addDie(smokedGlass, chromePip, 1.0, new THREE.Vector3(1.05, -0.08, -0.35), new THREE.Vector3(-0.4, 1, 0.7), -0.18, 2.1);

  // resting poses: a five and a two, tilted so three faces show
  dice[0].group.rotation.set(0.55, -0.6, 0.15);
  dice[1].group.rotation.set(-0.4, 0.8, 0.3);

  let width = 0;
  let height = 0;
  const resize = () => {
    const rect = canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect?.width ?? canvas.clientWidth));
    const h = Math.max(1, Math.floor(rect?.height ?? canvas.clientHeight));
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep both dice in frame when the hero gets narrow
    camera.fov = w / h < 1 ? 46 : w / h < 1.4 ? 38 : 32;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
  if (canvas.parentElement && observer) observer.observe(canvas.parentElement);
  window.addEventListener("resize", resize);

  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  let frame = 0;
  let first = true;
  const q = new THREE.Quaternion();

  const render = () => {
    const t = clock.getElapsedTime();
    for (const d of dice) {
      if (!reduced) {
        q.setFromAxisAngle(d.axis, d.speed * 0.016);
        d.group.quaternion.premultiply(q);
        d.group.position.y = d.base.y + Math.sin(t * 0.7 + d.phase) * 0.09;
      }
    }
    // the shadow follows the bob: higher die, softer shadow
    scene.children.forEach((o) => {
      if (o instanceof THREE.Mesh && o.material === shadowMaterial) {
        const die = dice.find((d) => Math.abs(d.base.x - o.position.x) < 0.01);
        if (die) o.scale.setScalar(1 + (die.group.position.y - die.base.y) * 0.9);
      }
    });
    renderer.render(scene, camera);
    if (first) {
      first = false;
      onFirstFrame?.();
    }
    if (!reduced) frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return {
    dispose: () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        }
      });
      env.dispose();
      shadowMap.dispose();
      fade.dispose();
      renderer.dispose();
    },
  };
}
