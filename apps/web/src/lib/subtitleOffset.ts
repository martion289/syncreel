export interface CueLike {
  startTime: number;
  endTime: number;
}

export type SubtitleSizePreset = 'small' | 'medium' | 'large' | 'xlarge';

export interface SubtitleAppearance {
  size: SubtitleSizePreset;
  bgOpacity: 0 | 0.5 | 0.82;
  offsetMs: number;
}

export const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = {
  size: 'medium',
  bgOpacity: 0.82,
  offsetMs: 0
};

const originalCueBounds = new WeakMap<CueLike, { start: number; end: number }>();

export function applyOffsetToCues(cues: Iterable<CueLike>, offsetMs: number): void {
  const shiftSec = offsetMs / 1000;
  for (const cue of cues) {
    let base = originalCueBounds.get(cue);
    if (!base) {
      base = { start: cue.startTime, end: cue.endTime };
      originalCueBounds.set(cue, base);
    }
    const nextStart = Math.max(0, base.start + shiftSec);
    const nextEnd = Math.max(nextStart + 0.1, base.end + shiftSec);
    cue.startTime = Number(nextStart.toFixed(3));
    cue.endTime = Number(nextEnd.toFixed(3));
  }
}

export function getSubtitleCssVars(appearance: SubtitleAppearance): {
  fontSize: string;
  bgColor: string;
} {
  const sizeMap: Record<SubtitleSizePreset, string> = {
    small: '0.88rem',
    medium: '1.05rem',
    large: '1.28rem',
    xlarge: '1.52rem'
  };
  return {
    fontSize: sizeMap[appearance.size],
    bgColor: `rgba(14, 14, 16, ${appearance.bgOpacity})`
  };
}
