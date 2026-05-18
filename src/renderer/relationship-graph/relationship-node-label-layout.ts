export type RelationshipNodeLabelVector = {
  readonly dx: number;
  readonly dy: number;
  readonly weight?: number;
};

export type RelationshipNodeLabelAnchor = {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
  readonly textAlign: CanvasTextAlign;
};

const fallbackAnchor: RelationshipNodeLabelAnchor = {
  x: 1,
  y: 0,
  textAlign: "left"
};

export function resolveNodeLabelAnchor(vectors: readonly RelationshipNodeLabelVector[]): RelationshipNodeLabelAnchor {
  let sumX = 0;
  let sumY = 0;
  let vectorCount = 0;

  for (const vector of vectors) {
    const length = Math.hypot(vector.dx, vector.dy);
    if (!Number.isFinite(length) || length <= 0.001) {
      continue;
    }
    const weight = Math.max(0.1, vector.weight ?? 1);
    sumX += (vector.dx / length) * weight;
    sumY += (vector.dy / length) * weight;
    vectorCount += 1;
  }

  if (vectorCount === 0 || Math.hypot(sumX, sumY) < 0.2) {
    return fallbackAnchor;
  }

  const awayX = -sumX;
  const awayY = -sumY;
  if (Math.abs(awayX) >= Math.abs(awayY) * 0.72) {
    return awayX < 0
      ? { x: -1, y: 0, textAlign: "right" }
      : { x: 1, y: 0, textAlign: "left" };
  }

  return awayY < 0
    ? { x: 0, y: -1, textAlign: "center" }
    : { x: 0, y: 1, textAlign: "center" };
}
