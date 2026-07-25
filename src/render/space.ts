// The camera sits behind the base and looks along +Z so the safe zone is always at the
// top of the screen. A camera looking down +Z mirrors world X on screen, so every
// sim -> three position conversion negates X. Keeping that in one place means the
// simulation can stay in plain (x, y) field coordinates.

/** Sim X -> three X. */
export const rx = (x: number) => -x;

/** Sim heading (atan2(vx, vy)) -> three Y rotation. */
export const rFacing = (facing: number) => -facing;
