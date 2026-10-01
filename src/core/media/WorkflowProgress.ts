export interface WorkflowProgressRange {
  start: number;
  end: number;
}

export interface WorkflowPhaseProgressRanges {
  translation?: WorkflowProgressRange;
  media: WorkflowProgressRange;
}

const TRANSLATION_PHASE_SHARE = 0.55;

export function getWorkflowPhaseProgressRanges(
  itemIndex: number,
  itemCount: number,
  includesTranslation: boolean
): WorkflowPhaseProgressRanges {
  const safeCount = Math.max(1, itemCount);
  const safeIndex = Math.max(0, Math.min(safeCount - 1, itemIndex));
  const itemStart = roundProgressBoundary((safeIndex / safeCount) * 100);
  const itemEnd = roundProgressBoundary(((safeIndex + 1) / safeCount) * 100);

  if (!includesTranslation) {
    return { media: { start: itemStart, end: itemEnd } };
  }

  const mediaStart = roundProgressBoundary(itemStart + (itemEnd - itemStart) * TRANSLATION_PHASE_SHARE);
  return {
    translation: { start: itemStart, end: mediaStart },
    media: { start: mediaStart, end: itemEnd }
  };
}

export function scaleWorkflowProgress(
  progressPercent: number | undefined,
  range: WorkflowProgressRange
): number | undefined {
  if (progressPercent === undefined || !Number.isFinite(progressPercent)) {
    return undefined;
  }

  const normalized = Math.max(0, Math.min(100, progressPercent)) / 100;
  return Math.round((range.start + (range.end - range.start) * normalized) * 10) / 10;
}

function roundProgressBoundary(value: number): number {
  return Math.round(value * 100) / 100;
}
