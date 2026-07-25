import * as THREE from 'three';
import { FIELD } from '../core/constants';
import type { GameMap, Obstacle } from '../core/map';
import { rx } from './space';

export type Weather = 'day' | 'sunset' | 'rain';

export interface WeatherPreset {
  sky: number;
  fog: number;
  fogDensity: number;
  sun: number;
  sunIntensity: number;
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
  grass: number;
  sunPos: [number, number, number];
}

export const WEATHER: Record<Weather, WeatherPreset> = {
  day: {
    sky: 0x9fd4f2,
    fog: 0xbfe3f5,
    fogDensity: 0.0042,
    sun: 0xfff3d4,
    sunIntensity: 2.1,
    ambientSky: 0xbfe3ff,
    ambientGround: 0x6b8f45,
    ambientIntensity: 1.15,
    grass: 0x76a63f,
    sunPos: [40, 60, -30],
  },
  sunset: {
    sky: 0xf0a860,
    fog: 0xe8996a,
    fogDensity: 0.0065,
    sun: 0xffb066,
    sunIntensity: 2.3,
    ambientSky: 0xffc48a,
    ambientGround: 0x4d5c2f,
    ambientIntensity: 0.95,
    grass: 0x6b8c3c,
    sunPos: [-55, 26, 10],
  },
  rain: {
    sky: 0x6d7c86,
    fog: 0x7e8d96,
    fogDensity: 0.012,
    sun: 0xc8d6dd,
    sunIntensity: 1.1,
    ambientSky: 0x8fa3b0,
    ambientGround: 0x46552f,
    ambientIntensity: 1.0,
    grass: 0x5e8437,
    sunPos: [20, 70, -20],
  },
};

const mat = (color: number, opts: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...opts });

function tree(seed: number): THREE.Group {
  const g = new THREE.Group();
  const h = 3.2 + seed * 2.4;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, h, 6), mat(0x6b4a2f));
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  g.add(trunk);

  for (let i = 0; i < 3; i++) {
    const r = 2.1 - i * 0.45;
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(r, 2.2 + i * 0.2, 7),
      mat(i === 0 ? 0x35702c : 0x3f8033),
    );
    leaf.position.y = h * 0.62 + i * 1.15;
    leaf.rotation.y = seed * 6 + i;
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

function palm(seed: number): THREE.Group {
  const g = new THREE.Group();
  const h = 6.5 + seed * 3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, h, 6), mat(0x8a6a45));
  trunk.position.y = h / 2;
  trunk.rotation.z = (seed - 0.5) * 0.16;
  trunk.castShadow = true;
  g.add(trunk);

  for (let i = 0; i < 7; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.6, 4), mat(0x2f7a35));
    frond.scale.set(1, 1, 0.25);
    const a = (i / 7) * Math.PI * 2 + seed;
    frond.position.set(Math.cos(a) * 1.5, h - 0.2, Math.sin(a) * 1.5);
    frond.rotation.set(Math.PI / 2.4, -a, 0);
    frond.castShadow = true;
    g.add(frond);
  }
  return g;
}

function haystack(seed: number): THREE.Group {
  const g = new THREE.Group();
  const h = 2.6 + seed;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, h, 9), mat(0xcfa63f));
  cone.position.y = h / 2;
  cone.castShadow = true;
  g.add(cone);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h + 0.9, 4), mat(0x7a5c34));
  pole.position.y = (h + 0.9) / 2;
  g.add(pole);
  return g;
}

function pot(seed: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), mat(0xa9563a));
  body.scale.y = 0.85;
  body.position.y = 0.5;
  body.castShadow = true;
  g.add(body);
  g.rotation.y = seed * 6;
  return g;
}

function house(o: Extract<Obstacle, { shape: 'box' }>): THREE.Group {
  const g = new THREE.Group();
  const wallH = 3.0;
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(o.hw * 2, wallH, o.hh * 2),
    mat(0xd8c9a4),
  );
  walls.position.y = wallH / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  // Corrugated-tin roof, the standard village silhouette.
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.hypot(o.hw, o.hh) * 1.18, 1.9, 4),
    mat(0x8f6a4a),
  );
  roof.position.y = wallH + 0.9;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);

  // Bamboo posts at the corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, wallH + 0.4, 5),
        mat(0x7d5a35),
      );
      post.position.set(sx * o.hw, (wallH + 0.4) / 2, sz * o.hh);
      g.add(post);
    }
  }
  return g;
}

function disc(radius: number, color: number, y: number, opacity = 1): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshLambertMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

function band(y0: number, y1: number, color: number, height: number, opacity = 1): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.halfW * 2, y1 - y0),
    new THREE.MeshLambertMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, height, (y0 + y1) / 2);
  m.receiveShadow = true;
  return m;
}

export interface VillageHandles {
  root: THREE.Group;
  rain: THREE.Points | null;
  setWeather(w: Weather): void;
}

export function buildVillage(
  scene: THREE.Scene,
  map: GameMap,
  hemi: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  initial: Weather,
): VillageHandles {
  const root = new THREE.Group();
  scene.add(root);

  // --- ground: the pitch plus paddy fields running out to the horizon
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), mat(0x5f8a37));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.06;
  outer.receiveShadow = true;
  root.add(outer);

  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.halfW * 2 + 6, FIELD.safeBack - FIELD.baseBack + 6),
    mat(0x76a63f),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, -0.02, (FIELD.safeBack + FIELD.baseBack) / 2);
  pitch.receiveShadow = true;
  root.add(pitch);

  // Paddy stripes so the field reads as cultivated ground, not a football pitch.
  for (let i = -10; i <= 10; i++) {
    if (i === 0) continue;
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 380),
      mat(i % 2 === 0 ? 0x6b9a36 : 0x5b8a30),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(i * 34, -0.05, 0);
    root.add(stripe);
  }

  root.add(band(FIELD.baseBack, FIELD.baseFront, 0xb98a52, 0.01));
  root.add(band(FIELD.safeFront, FIELD.safeBack, 0xe8c765, 0.01));

  // Defender lines — packed dirt tracks worn into the grass.
  for (const ly of FIELD.lines) {
    root.add(band(ly - 0.55, ly + 0.55, 0xc9a76a, 0.02));
  }

  // Touchlines: bamboo posts down each side.
  for (let y = FIELD.baseBack; y <= FIELD.safeBack; y += 6) {
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 1.5, 5),
        mat(0xbba06a),
      );
      post.position.set(sx * FIELD.halfW, 0.75, y);
      root.add(post);
    }
  }

  // --- props from the collision map, so what you see is what you hit
  for (const o of map.obstacles) {
    let node: THREE.Object3D | null = null;
    if (o.shape === 'box') {
      node = house(o);
    } else {
      switch (o.kind) {
        case 'tree':
          node = tree(o.seed);
          break;
        case 'palm':
          node = palm(o.seed);
          break;
        case 'haystack':
          node = haystack(o.seed);
          break;
        case 'pot':
          node = pot(o.seed);
          break;
        case 'pond': {
          const water = disc(o.r, 0x3d7fa6, 0.03, 0.88);
          const rim = disc(o.r + 0.7, 0x8a7247, 0.02, 0.9);
          water.position.set(rx(o.x), 0.03, o.y);
          rim.position.set(rx(o.x), 0.02, o.y);
          root.add(rim);
          root.add(water);
          break;
        }
        case 'mud': {
          const m = disc(o.r, 0x6d5433, 0.025, 0.95);
          m.position.set(rx(o.x), 0.025, o.y);
          root.add(m);
          break;
        }
      }
    }
    if (node) {
      node.position.set(rx(o.x), 0, o.y);
      root.add(node);
    }
  }

  // A few trees outside the touchlines for depth.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const rr = 46 + ((i * 37) % 40);
    const node = i % 3 === 0 ? palm((i % 7) / 7) : tree((i % 5) / 5);
    node.position.set(Math.cos(a) * rr, 0, 39 + Math.sin(a) * rr);
    root.add(node);
  }

  // --- rain, reused across weather switches
  const drops = 2600;
  const pos = new Float32Array(drops * 3);
  for (let i = 0; i < drops; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 140;
    pos[i * 3 + 1] = Math.random() * 40;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 160 + 39;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.Points(
    rainGeo,
    new THREE.PointsMaterial({ color: 0xcfe4ef, size: 0.28, transparent: true, opacity: 0.65 }),
  );
  rain.visible = false;
  scene.add(rain);

  function setWeather(kind: Weather): void {
    const p = WEATHER[kind];
    scene.background = new THREE.Color(p.sky);
    scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    sun.color.setHex(p.sun);
    sun.intensity = p.sunIntensity;
    sun.position.set(...p.sunPos);
    hemi.color.setHex(p.ambientSky);
    hemi.groundColor.setHex(p.ambientGround);
    hemi.intensity = p.ambientIntensity;
    (pitch.material as THREE.MeshLambertMaterial).color.setHex(p.grass);
    rain.visible = kind === 'rain';
  }

  setWeather(initial);

  return { root, rain, setWeather };
}

/** Falling-rain animation; no-op when rain is hidden. */
export function tickRain(rain: THREE.Points | null, dt: number, focusZ: number): void {
  if (!rain || !rain.visible) return;
  const attr = rain.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 1; i < arr.length; i += 3) {
    arr[i] -= 34 * dt;
    if (arr[i] < 0) {
      arr[i] = 38 + Math.random() * 6;
      arr[i - 1] = (Math.random() - 0.5) * 140;
      arr[i + 1] = (Math.random() - 0.5) * 90 + focusZ;
    }
  }
  attr.needsUpdate = true;
}
