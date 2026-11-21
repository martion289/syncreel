export interface DriftInput {
  expectedMs: number;
  actualMs: number;
  currentRate: number;
  supportsRateNudge?: boolean;
}

export type DriftDecision =
  | { action: 'none' }
  | { action: 'nudge'; targetRate: number }
  | { action: 'seek'; seekToMs: number; targetRate: number };

export function evaluateDrift(input: DriftInput): DriftDecision {
  const { expectedMs, actualMs, currentRate, supportsRateNudge = true } = input;
  const driftMs = actualMs - expectedMs;
  const absDrift = Math.abs(driftMs);

  // Tier 3: Large gap -> clean hard seek slightly ahead of current anchor
  if (absDrift > 1500) {
    return {
      action: 'seek',
      seekToMs: Math.max(0, Math.round(expectedMs + 150)),
      targetRate: 1
    };
  }

  if (!supportsRateNudge) {
    return { action: 'none' };
  }

  // Currently nudging: stay nudging until inside tight 80ms window, then snap back to 1.0
  if (currentRate !== 1) {
    if (absDrift < 80) {
      return { action: 'nudge', targetRate: 1 };
    }
    return { action: 'nudge', targetRate: driftMs > 0 ? 0.95 : 1.05 };
  }

  // Tier 2: Moderate drift -> gentle playbackRate catchup/slowdown
  if (absDrift >= 180) {
    return {
      action: 'nudge',
      targetRate: driftMs > 0 ? 0.95 : 1.05
    };
  }

  // Tier 1: Within deadband (<180ms)
  return { action: 'none' };
}
