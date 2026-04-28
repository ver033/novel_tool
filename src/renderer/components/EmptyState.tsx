type EmptyStateProps = {
  readonly title: string;
  readonly description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
