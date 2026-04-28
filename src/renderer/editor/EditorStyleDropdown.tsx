import { useState } from "react";

type EditorStyleDropdownProps = {
  readonly label: string;
  readonly options: readonly {
    readonly label: string;
    readonly active?: boolean;
    readonly onSelect: () => void;
  }[];
};

export function EditorStyleDropdown({ label, options }: EditorStyleDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="editor-style-dropdown">
      <button
        className={`tool-button select-button ${open ? "active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        onMouseDown={(event) => event.preventDefault()}
        type="button"
      >
        {label}⌄
      </button>
      {open ? (
        <span className="style-dropdown-menu">
          {options.map((option) => (
            <button
              className={option.active ? "selected" : ""}
              key={option.label}
              onClick={() => {
                option.onSelect();
                setOpen(false);
              }}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
