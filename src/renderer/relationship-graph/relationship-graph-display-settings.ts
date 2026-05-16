export type RelationshipGraphLabelDensity = "essential" | "balanced" | "full";

export type RelationshipGraphDisplaySettings = {
  readonly nodeRepulsionScale: number;
  readonly linkDistanceScale: number;
  readonly labelDensity: RelationshipGraphLabelDensity;
};

export const defaultRelationshipGraphDisplaySettings: RelationshipGraphDisplaySettings = {
  nodeRepulsionScale: 1.3,
  linkDistanceScale: 1.15,
  labelDensity: "balanced"
};
