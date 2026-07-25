import * as THREE from 'three';
import { FIELD } from '../core/constants';
import type { GameMap } from '../core/map';
import type { World } from '../core/types';
import { ActorLayer, FxLayer } from './actors';
import { rx } from './space';
import { WEATHER, buildVillage, tickRain, type VillageHandles, type Weather } from './village';

/**
 * The camera always points the same way — safe zone toward the top of the screen —
 * so W/up means "toward the safe zone" whichever side you are playing.
 */
export class GameView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly actors: ActorLayer;
  readonly fx: FxLayer;

  private village: VillageHandles;
  private focus = new THREE.Vector3(0, 0, 0);
  private sun: THREE.DirectionalLight;
  /** Sun direction for the current weather, applied relative to the camera focus. */
  private sunOffset = new THREE.Vector3(40, 60, -30);

  constructor(canvas: HTMLCanvasElement, map: GameMap, weather: Weather) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 600);
    this.camera.position.set(0, 26, -26);

    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x6b8f45, 1.1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d4, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -FIELD.halfW - 12;
    cam.right = FIELD.halfW + 12;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 260;
    sun.target.position.set(0, 0, 40);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.village = buildVillage(this.scene, map, hemi, sun, weather);
    this.sunOffset.set(...WEATHER[weather].sunPos);
    this.actors = new ActorLayer(this.scene);
    this.fx = new FxLayer(this.scene);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setWeather(w: Weather): void {
    this.village.setWeather(w);
    this.sunOffset.set(...WEATHER[w].sunPos);
  }

  resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(world: World, dt: number, playerId: number | null): void {
    this.actors.sync(world, dt);
    this.fx.sync(world);

    const me = world.actors.find((a) => a.id === playerId);
    const targetX = me ? rx(me.pos.x) * 0.55 : 0;
    const targetZ = me ? me.pos.y : 30;

    // Pull back a little during the line-up so you can read the whole field.
    const wide = world.phase === 'lineup' || world.phase === 'roundover' || world.phase === 'matchover';
    const height = wide ? 34 : 24;
    const back = wide ? 34 : 24;

    const k = 1 - Math.exp(-4.5 * dt);
    this.focus.x += (targetX - this.focus.x) * k;
    this.focus.z += (targetZ - this.focus.z) * k;

    this.camera.position.set(this.focus.x, height, this.focus.z - back);
    this.camera.lookAt(this.focus.x, 1.2, this.focus.z + (wide ? 14 : 10));

    this.sun.target.position.set(this.focus.x, 0, this.focus.z);
    this.sun.position.set(
      this.focus.x + this.sunOffset.x,
      this.sunOffset.y,
      this.focus.z + this.sunOffset.z,
    );

    tickRain(this.village.rain, dt, this.focus.z);
    this.renderer.render(this.scene, this.camera);
  }
}
