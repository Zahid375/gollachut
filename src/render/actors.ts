import * as THREE from 'three';
import { role } from '../core/roles';
import { isInvisible, isUltActive } from '../core/rules';
import type { Actor, World } from '../core/types';
import { rFacing, rx } from './space';

const SKIN = 0x9c6b47;

interface Rig {
  group: THREE.Group;
  body: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  ring: THREE.Mesh;
  shield: THREE.Mesh;
  campRing: THREE.Mesh;
  mats: THREE.MeshLambertMaterial[];
  phase: number;
}

function makeRig(a: Actor): Rig {
  const def = role(a.role);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const mats: THREE.MeshLambertMaterial[] = [];
  const m = (color: number) => {
    const mm = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 });
    mats.push(mm);
    return mm;
  };

  const kurta = m(def.tint);
  const skin = m(SKIN);
  const lungi = m(a.team === 'blue' ? 0x24406b : 0x6b2424);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 4, 8), kurta);
  torso.position.y = 1.22;
  torso.castShadow = true;
  body.add(torso);

  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.7, 8), lungi);
  skirt.position.y = 0.78;
  skirt.castShadow = true;
  body.add(skirt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  body.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, 1.1), m(0x191410));
  hair.position.y = 1.8;
  body.add(hair);

  if (a.isCaptain) {
    // Red gamcha knotted round the captain's head.
    const gamcha = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.07, 6, 12), m(0xe03b2f));
    gamcha.position.y = 1.86;
    gamcha.rotation.x = Math.PI / 2;
    body.add(gamcha);
  }

  const limb = (x: number, y: number, len: number, colour: THREE.MeshLambertMaterial) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, len, 3, 6), colour);
    mesh.position.set(x, y, 0);
    mesh.castShadow = true;
    body.add(mesh);
    return mesh;
  };

  const legL = limb(-0.16, 0.42, 0.5, skin);
  const legR = limb(0.16, 0.42, 0.5, skin);
  const armL = limb(-0.44, 1.24, 0.44, skin);
  const armR = limb(0.44, 1.24, 0.44, skin);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.82, 20),
    new THREE.MeshBasicMaterial({
      color: a.team === 'blue' ? 0x4aa3ff : 0xff5a45,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0x8fd8ff,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
  shield.position.y = 1.05;
  shield.visible = false;
  group.add(shield);

  const campRing = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.5, 22),
    new THREE.MeshBasicMaterial({
      color: 0xffc02e,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  campRing.rotation.x = -Math.PI / 2;
  campRing.position.y = 0.05;
  campRing.visible = false;
  group.add(campRing);

  return { group, body, legL, legR, armL, armR, ring, shield, campRing, mats, phase: a.id * 1.7 };
}

export class ActorLayer {
  private rigs = new Map<number, Rig>();
  private root = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Drops every rig — call when a new round rebuilds the actor list. */
  reset(): void {
    for (const rig of this.rigs.values()) this.root.remove(rig.group);
    this.rigs.clear();
  }

  positionOf(id: number): THREE.Vector3 | null {
    return this.rigs.get(id)?.group.position ?? null;
  }

  sync(w: World, dt: number): void {
    for (const a of w.actors) {
      let rig = this.rigs.get(a.id);
      if (!rig) {
        rig = makeRig(a);
        this.rigs.set(a.id, rig);
        this.root.add(rig.group);
      }

      const speed = Math.hypot(a.vel.x, a.vel.y);
      rig.phase += dt * (2.2 + speed * 1.5);

      rig.group.position.set(rx(a.pos.x), 0, a.pos.y);
      rig.body.rotation.y = rFacing(a.facing);

      // Run cycle: legs counter-swing, arms mirror, body bobs with stride.
      const swing = Math.sin(rig.phase) * Math.min(0.85, speed * 0.16);
      rig.legL.rotation.x = swing;
      rig.legR.rotation.x = -swing;
      rig.armL.rotation.x = -swing * 0.8;
      rig.armR.rotation.x = swing * 0.8;
      rig.body.position.y = Math.abs(Math.sin(rig.phase)) * Math.min(0.12, speed * 0.02);

      // Vault hop.
      if (a.vaultUntil > w.t) {
        const k = 1 - (a.vaultUntil - w.t) / 0.45;
        rig.body.position.y += Math.sin(k * Math.PI) * 0.9;
      }

      let opacity = 1;
      let dim = false;

      if (a.state === 'caught') {
        opacity = 0.42;
        dim = true;
        rig.body.rotation.z = -0.9;
        rig.body.position.y = -0.25;
      } else {
        rig.body.rotation.z = 0;
      }

      if (a.state === 'safe') {
        rig.body.position.y += 0.25 + Math.sin(w.t * 5 + rig.phase) * 0.12;
        rig.armL.rotation.x = -2.4;
        rig.armR.rotation.x = -2.4;
      }

      if (a.state === 'held') {
        rig.body.position.y = 0;
        rig.legL.rotation.x = 0;
        rig.legR.rotation.x = 0;
        opacity = 0.75;
      }

      if (isInvisible(w, a)) opacity = a.isPlayer ? 0.35 : 0.08;

      for (const mm of rig.mats) {
        mm.opacity = opacity;
        mm.transparent = opacity < 1;
      }
      const tintTarget = dim ? 0x555555 : 0xffffff;
      rig.mats.forEach((mm) => {
        if (dim) mm.color.lerp(new THREE.Color(tintTarget), 0.08);
      });

      rig.shield.visible = a.role === 'tank' && isUltActive(w, a);
      if (rig.shield.visible) rig.shield.rotation.y += dt * 1.6;

      rig.campRing.visible = a.campPenalty > 0.03;
      if (rig.campRing.visible) {
        const s = 1 + Math.sin(w.t * 7) * 0.08;
        rig.campRing.scale.set(s, s, s);
        (rig.campRing.material as THREE.MeshBasicMaterial).opacity = 0.2 + a.campPenalty;
      }

      const ringMat = rig.ring.material as THREE.MeshBasicMaterial;
      if (a.isPlayer) {
        ringMat.color.setHex(0xffe27a);
        ringMat.opacity = 0.85 + Math.sin(w.t * 4) * 0.12;
        rig.ring.scale.setScalar(1.15);
      } else {
        ringMat.opacity = a.state === 'caught' ? 0.15 : 0.5;
      }
    }
  }
}

/** Bamboo barriers, footprints, signal pings and the radar sweep. */
export class FxLayer {
  private root = new THREE.Group();
  private wallPool: THREE.Mesh[] = [];
  private printPool: THREE.Mesh[] = [];
  private pingPool: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  private take(
    pool: THREE.Mesh[],
    i: number,
    make: () => THREE.Mesh,
  ): THREE.Mesh {
    let m = pool[i];
    if (!m) {
      m = make();
      pool[i] = m;
      this.root.add(m);
    }
    m.visible = true;
    return m;
  }

  sync(w: World): void {
    // --- walls
    w.walls.forEach((wall, i) => {
      const m = this.take(this.wallPool, i, () =>
        new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshLambertMaterial({ color: 0xb08a4a, transparent: true, opacity: 0.92 }),
        ),
      );
      const life = Math.min(1, (wall.until - w.t) / 0.6);
      m.scale.set(wall.halfLen * 2, 2.1 * life, 0.45);
      m.position.set(rx(wall.x), (2.1 * life) / 2, wall.y);
      m.castShadow = true;
    });
    for (let i = w.walls.length; i < this.wallPool.length; i++) this.wallPool[i].visible = false;

    // --- footprints
    w.prints.forEach((p, i) => {
      const m = this.take(this.printPool, i, () =>
        new THREE.Mesh(
          new THREE.CircleGeometry(0.24, 8),
          new THREE.MeshBasicMaterial({
            color: 0x4a3a24,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          }),
        ),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(rx(p.x), 0.035, p.y);
      const mm = m.material as THREE.MeshBasicMaterial;
      mm.opacity = Math.max(0, (p.until - w.t) / 2.6) * 0.55;
      mm.color.setHex(p.fake ? 0x7b5a2a : 0x4a3a24);
    });
    for (let i = w.prints.length; i < this.printPool.length; i++) this.printPool[i].visible = false;

    // --- pings
    w.pings.forEach((p, i) => {
      const m = this.take(this.pingPool, i, () =>
        new THREE.Mesh(
          new THREE.RingGeometry(0.8, 1.15, 24),
          new THREE.MeshBasicMaterial({
            color: 0xffe27a,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(rx(p.x), 0.06, p.y);
      const k = 1 - (p.until - w.t) / 5;
      const pulse = 1 + ((k * 3) % 1) * 2.4;
      m.scale.setScalar(pulse);
      const mm = m.material as THREE.MeshBasicMaterial;
      mm.opacity = Math.max(0, 0.8 - ((k * 3) % 1) * 0.8);
      mm.color.setHex(p.team === 'blue' ? 0x7ec8ff : 0xff8a72);
    });
    for (let i = w.pings.length; i < this.pingPool.length; i++) this.pingPool[i].visible = false;
  }
}
