import * as THREE from 'three';
import { FIELD } from '../core/constants';
import type { GameMap } from '../core/map';
import type { Actor, World } from '../core/types';
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
  /**
   * Cut rather than glide on the next frame. The focus point persists across rounds, so
   * without this the camera opens each round parked where the previous one ended and slides
   * across the field — at a side swap that is a 40m sweep, and the round looks like it
   * started somewhere other than your spawn.
   */
  private snapNext = true;
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

    // `resize` alone misses the two things that actually change the viewport on a phone:
    // the URL bar sliding away, and rotation (which fires before the new size is readable).
    // Everything is funnelled through one rAF-coalesced handler so a drag-resize on desktop
    // does not reallocate the drawing buffer dozens of times a second.
    const schedule = () => this.scheduleResize();
    addEventListener('resize', schedule);
    addEventListener('orientationchange', schedule);
    visualViewport?.addEventListener('resize', schedule);
    visualViewport?.addEventListener('scroll', schedule);
  }

  private resizePending = false;

  private scheduleResize(): void {
    if (this.resizePending) return;
    this.resizePending = true;
    requestAnimationFrame(() => {
      this.resizePending = false;
      this.resize();
    });
  }

  /** Cut the camera straight to the player next frame — call whenever the round resets. */
  snapToPlayer(): void {
    this.snapNext = true;
  }

  setWeather(w: Weather): void {
    this.village.setWeather(w);
    this.sunOffset.set(...WEATHER[w].sunPos);
  }

  resize(): void {
    // visualViewport tracks the area actually visible once mobile browser chrome is taken
    // into account; innerWidth/Height do not, which leaves a strip of canvas off-screen.
    const vv = visualViewport;
    const w = Math.max(1, Math.round(vv?.width ?? innerWidth));
    const h = Math.max(1, Math.round(vv?.height ?? innerHeight));

    // Cap the pixel ratio harder on phones — a 3x buffer on a mid-range device costs far
    // more than it shows, and this scene is fill-rate bound because of the shadow pass.
    const cap = Math.min(innerWidth, innerHeight) < 700 ? 1.75 : 2;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));

    // `true` so three writes the CSS size too. The drawing buffer and the displayed box
    // must come from the same measurement or the picture stretches.
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    // Portrait phones see far less of the field horizontally; widen the lens so the same
    // amount of pitch stays readable instead of the camera feeling zoomed in.
    this.camera.fov = this.camera.aspect < 0.8 ? 66 : 52;
    this.camera.updateProjectionMatrix();
  }

  update(world: World, dt: number, me: Actor | null): void {
    this.actors.sync(world, dt);
    this.fx.sync(world);

    const targetX = me ? rx(me.pos.x) * 0.55 : 0;
    const targetZ = me ? me.pos.y : 30;

    // Pull back a little during the line-up so you can read the whole field.
    const wide = world.phase === 'lineup' || world.phase === 'roundover' || world.phase === 'matchover';
    const height = wide ? 34 : 24;
    const back = wide ? 34 : 24;

    const k = this.snapNext ? 1 : 1 - Math.exp(-4.5 * dt);
    this.snapNext = false;
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
