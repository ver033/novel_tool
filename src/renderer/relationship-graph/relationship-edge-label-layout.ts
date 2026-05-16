type RelationshipEdgeLabelPoint = {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly relationshipWeight?: number;
  readonly labelWidth?: number;
  readonly labelHeight?: number;
};

export type RelationshipEdgeLabelBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type RelationshipEdgeLabelViewport = {
  readonly width: number;
  readonly height: number;
};

type RelationshipEdgeLabelPlacementInput = {
  readonly edgeKey: string;
  readonly label: string;
  readonly source: RelationshipEdgeLabelPoint;
  readonly target: RelationshipEdgeLabelPoint;
  readonly edgeSize: number;
  readonly fontSize: number;
  readonly textWidth?: number;
  readonly textHeight?: number;
  readonly viewport?: RelationshipEdgeLabelViewport;
  readonly occupiedBoxes?: readonly RelationshipEdgeLabelBox[];
};

export type RelationshipEdgeLabelPlacement = {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly ratio: number;
  readonly normalOffset: number;
  readonly box?: RelationshipEdgeLabelBox;
};

const labelBoxRegistry = new WeakMap<HTMLCanvasElement, RelationshipEdgeLabelBox[]>();

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function keepTextUpright(angle: number): number {
  if (angle > Math.PI / 2) {
    return angle - Math.PI;
  }
  if (angle < -Math.PI / 2) {
    return angle + Math.PI;
  }
  return angle;
}

function resolveRatioOptions(
  source: RelationshipEdgeLabelPoint,
  target: RelationshipEdgeLabelPoint,
  length: number
): readonly number[] {
  const sourceWeight = Math.max(0, source.relationshipWeight ?? 0);
  const targetWeight = Math.max(0, target.relationshipWeight ?? 0);
  const weightGap = sourceWeight - targetWeight;
  const maxWeight = Math.max(sourceWeight, targetWeight);
  const shouldBiasToPeripheralEndpoint = maxWeight >= 6 && Math.abs(weightGap) >= 4;

  if (!shouldBiasToPeripheralEndpoint) {
    return length >= 220 ? [0.38, 0.5, 0.62] : [0.5];
  }

  const peripheralRatio = weightGap > 0 ? 0.76 : 0.24;
  if (length < 220) {
    return [peripheralRatio];
  }

  return [peripheralRatio - 0.06, peripheralRatio, peripheralRatio + 0.06];
}

function uniqueSortedRatios(ratios: readonly number[]): readonly number[] {
  return [...new Set(ratios.map((ratio) => Math.round(ratio * 100) / 100))].sort((left, right) => left - right);
}

function resolveCandidateRatios(
  source: RelationshipEdgeLabelPoint,
  target: RelationshipEdgeLabelPoint,
  length: number,
  hasCollisionContext: boolean
): readonly number[] {
  const baseRatios = resolveRatioOptions(source, target, length);
  if (!hasCollisionContext) {
    return baseRatios;
  }

  const expandedRatios = length >= 220
    ? [0.14, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86]
    : [0.28, 0.38, 0.5, 0.62, 0.72];
  return uniqueSortedRatios([...baseRatios, ...expandedRatios]);
}

function labelBoxAt(x: number, y: number, width: number, height: number, angle: number): RelationshipEdgeLabelBox {
  const safeWidth = Math.max(1, width) + 8;
  const safeHeight = Math.max(1, height) + 6;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const rotatedWidth = cos * safeWidth + sin * safeHeight;
  const rotatedHeight = sin * safeWidth + cos * safeHeight;
  return {
    x: x - rotatedWidth / 2,
    y: y - rotatedHeight / 2,
    width: rotatedWidth,
    height: rotatedHeight
  };
}

function pointBox(point: RelationshipEdgeLabelPoint): RelationshipEdgeLabelBox {
  const padding = 6;
  const size = point.size + padding;
  return {
    x: point.x - size,
    y: point.y - size,
    width: size * 2,
    height: size * 2
  };
}

function pointLabelBox(point: RelationshipEdgeLabelPoint): RelationshipEdgeLabelBox | undefined {
  if (!point.labelWidth || !point.labelHeight) {
    return undefined;
  }

  const horizontalGap = point.size + 6;
  const horizontalPadding = 8;
  const verticalPadding = 6;
  return {
    x: point.x + horizontalGap,
    y: point.y - point.labelHeight / 2 - verticalPadding / 2,
    width: point.labelWidth + horizontalPadding,
    height: point.labelHeight + verticalPadding
  };
}

function boxOverlapArea(left: RelationshipEdgeLabelBox, right: RelationshipEdgeLabelBox): number {
  const xOverlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const yOverlap = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return xOverlap * yOverlap;
}

function viewportOverflow(box: RelationshipEdgeLabelBox, viewport: RelationshipEdgeLabelViewport | undefined): number {
  if (!viewport) {
    return 0;
  }
  return (
    Math.max(0, -box.x) +
    Math.max(0, -box.y) +
    Math.max(0, box.x + box.width - viewport.width) +
    Math.max(0, box.y + box.height - viewport.height)
  );
}

function scoreCandidate({
  box,
  ratio,
  normalOffset,
  preferredRatio,
  occupiedBoxes,
  source,
  target,
  viewport
}: {
  readonly box: RelationshipEdgeLabelBox | undefined;
  readonly ratio: number;
  readonly normalOffset: number;
  readonly preferredRatio: number;
  readonly occupiedBoxes: readonly RelationshipEdgeLabelBox[];
  readonly source: RelationshipEdgeLabelPoint;
  readonly target: RelationshipEdgeLabelPoint;
  readonly viewport: RelationshipEdgeLabelViewport | undefined;
}): number {
  if (!box) {
    return Math.abs(ratio - preferredRatio) * 100 + Math.abs(normalOffset) * 0.15;
  }

  const occupiedOverlap = occupiedBoxes.reduce((total, occupied) => total + boxOverlapArea(box, occupied), 0);
  const nodeOverlap = boxOverlapArea(box, pointBox(source)) + boxOverlapArea(box, pointBox(target));
  const sourceLabelBox = pointLabelBox(source);
  const targetLabelBox = pointLabelBox(target);
  const nodeLabelOverlap =
    (sourceLabelBox ? boxOverlapArea(box, sourceLabelBox) : 0) +
    (targetLabelBox ? boxOverlapArea(box, targetLabelBox) : 0);
  const overflow = viewportOverflow(box, viewport);
  return (
    occupiedOverlap * 180 +
    nodeOverlap * 300 +
    nodeLabelOverlap * 260 +
    overflow * 40 +
    Math.abs(ratio - preferredRatio) * 70 +
    Math.abs(normalOffset) * 0.16
  );
}

export function resetRelationshipEdgeLabelRegistry(canvas: HTMLCanvasElement): void {
  labelBoxRegistry.set(canvas, []);
}

export function getRelationshipEdgeLabelBoxes(canvas: HTMLCanvasElement): readonly RelationshipEdgeLabelBox[] {
  return labelBoxRegistry.get(canvas) ?? [];
}

export function reserveRelationshipEdgeLabelBox(canvas: HTMLCanvasElement, box: RelationshipEdgeLabelBox): void {
  const boxes = labelBoxRegistry.get(canvas);
  if (boxes) {
    boxes.push(box);
    return;
  }
  labelBoxRegistry.set(canvas, [box]);
}

export function resolveRelationshipEdgeLabelPlacement({
  edgeKey,
  label,
  source,
  target,
  edgeSize,
  fontSize,
  textWidth,
  textHeight,
  viewport,
  occupiedBoxes = []
}: RelationshipEdgeLabelPlacementInput): RelationshipEdgeLabelPlacement {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const hash = stableHash(`${edgeKey}:${label}`);
  const hasCollisionContext = Boolean(textWidth && textHeight && (occupiedBoxes.length > 0 || viewport));
  const baseRatioOptions = resolveRatioOptions(source, target, length);
  const ratioOptions = resolveCandidateRatios(source, target, length, hasCollisionContext);
  const laneIndex = Math.floor(hash / 2) % baseRatioOptions.length;
  const preferredRatio = baseRatioOptions[laneIndex];
  const textHalfWidthRatio = textWidth ? textWidth / 2 / length : 0;
  const labelRatioPadding = Math.min(
    0.44,
    (Math.max(source.size, target.size) + fontSize * 1.6) / length + textHalfWidthRatio
  );
  const initialSide = (hash >>> 4) % 2 === 0 ? 1 : -1;
  const hubOffsetBonus = baseRatioOptions.length > 1 && Math.abs(baseRatioOptions[0] - 0.38) > 0.01 ? 0.8 : 0;
  const baseNormalDistance = Math.max(6, edgeSize * 1.4 + 4) + laneIndex * 1.1 + hubOffsetBonus;
  const normalX = -dy / length;
  const normalY = dx / length;
  const angle = keepTextUpright(Math.atan2(dy, dx));

  let bestPlacement: RelationshipEdgeLabelPlacement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const sideOptions = hasCollisionContext ? [initialSide, -initialSide] : [initialSide];
  const offsetOptions = hasCollisionContext ? [0, 1, 3, 5] : [0];

  for (const ratioCandidate of ratioOptions) {
    const ratio = clamp(ratioCandidate, labelRatioPadding, 1 - labelRatioPadding);
    for (const side of sideOptions) {
      for (const offset of offsetOptions) {
        const normalOffset = side * (baseNormalDistance + offset);
        const x = source.x + dx * ratio + normalX * normalOffset;
        const y = source.y + dy * ratio + normalY * normalOffset;
        const box =
          textWidth && textHeight ? labelBoxAt(x, y, textWidth, textHeight, angle) : undefined;
        const score = scoreCandidate({
          box,
          ratio,
          normalOffset,
          preferredRatio,
          occupiedBoxes,
          source,
          target,
          viewport
        });
        if (score < bestScore) {
          bestScore = score;
          bestPlacement = {
            x,
            y,
            angle,
            ratio,
            normalOffset,
            box
          };
        }
      }
    }
  }

  return bestPlacement ?? {
    x: source.x + dx * 0.5,
    y: source.y + dy * 0.5,
    angle,
    ratio: 0.5,
    normalOffset: 0
  };
}
