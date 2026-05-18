export type AuthorRelationshipCreateInput = {
  readonly sourceCharacterName: string;
  readonly targetCharacterName: string;
  readonly sourceToTargetLabel: string;
  readonly targetToSourceLabel: string | null;
};

export type AuthorRelationshipFormDraft = {
  readonly sourceCharacterName: string;
  readonly targetCharacterName: string;
  readonly sourceToTargetLabel: string;
  readonly targetToSourceLabel: string;
  readonly sameRelationBothWays: boolean;
};

function trimRelationshipField(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildAuthorRelationshipCreateInput(input: AuthorRelationshipFormDraft): AuthorRelationshipCreateInput {
  const sourceToTargetLabel = trimRelationshipField(input.sourceToTargetLabel);
  const reverseLabel = trimRelationshipField(input.targetToSourceLabel);
  return {
    sourceCharacterName: trimRelationshipField(input.sourceCharacterName),
    targetCharacterName: trimRelationshipField(input.targetCharacterName),
    sourceToTargetLabel,
    targetToSourceLabel: input.sameRelationBothWays ? sourceToTargetLabel : reverseLabel || null
  };
}
