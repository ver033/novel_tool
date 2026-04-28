type TabsProps<T extends string> = {
  readonly items: readonly T[];
  readonly active: T;
  readonly onChange: (item: T) => void;
};

export function Tabs<T extends string>({ items, active, onChange }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          className={`tab-button ${active === item ? "active" : ""}`}
          key={item}
          onClick={() => onChange(item)}
          role="tab"
          type="button"
        >
          {item}
        </button>
      ))}
    </div>
  );
}
