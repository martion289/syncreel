export const SWIPE_DISTANCE_THRESHOLD = 85;
export const SWIPE_FLICK_MIN_DISTANCE = 32;
export const SWIPE_FLICK_VELOCITY = 0.45;

export interface PointerSample {
  x: number;
  t: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveSwipeDecision(dx: number, velocityX: number): 'yes' | 'no' | null {
  if (
    dx >= SWIPE_DISTANCE_THRESHOLD ||
    (dx >= SWIPE_FLICK_MIN_DISTANCE && velocityX >= SWIPE_FLICK_VELOCITY)
  ) {
    return 'yes';
  }
  if (
    dx <= -SWIPE_DISTANCE_THRESHOLD ||
    (dx <= -SWIPE_FLICK_MIN_DISTANCE && velocityX <= -SWIPE_FLICK_VELOCITY)
  ) {
    return 'no';
  }
  return null;
}

export function computeCardTransform(dx: number, dy: number, grabFromUpperHalf: boolean) {
  const rotateDeg = clamp((dx / 18) * (grabFromUpperHalf ? 1 : -0.75), -22, 22);
  const translateY = dy * 0.35;
  const progress = Math.min(1, Math.abs(dx) / 110);
  return {
    translateX: dx,
    translateY,
    rotateDeg,
    progress
  };
}

export function computeUnderCardStyle(progress: number) {
  const p = clamp(progress, 0, 1);
  return {
    scale: 0.94 + 0.06 * p,
    translateY: 12 * (1 - p),
    opacity: 0.78 + 0.22 * p
  };
}

export function computeVelocityX(samples: readonly PointerSample[], windowMs = 90): number {
  if (samples.length < 2) return 0;
  const latest = samples[samples.length - 1];
  const cutoff = latest.t - windowMs;

  let anchor = samples[samples.length - 2];
  for (let i = 0; i < samples.length - 1; i++) {
    if (samples[i].t >= cutoff) {
      anchor = samples[i];
      break;
    }
  }

  const dt = latest.t - anchor.t;
  if (dt <= 0) return 0;
  return (latest.x - anchor.x) / dt;
}
