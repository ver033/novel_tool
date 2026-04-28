import { Extension } from "@tiptap/core";

export type TextAlignValue = "left" | "center" | "right" | "justify";

type TextAlignOptions = {
  readonly types: readonly string[];
  readonly alignments: readonly TextAlignValue[];
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textAlign: {
      setTextAlign: (alignment: TextAlignValue) => ReturnType;
      unsetTextAlign: () => ReturnType;
    };
  }
}

export const TextAlignExtension = Extension.create<TextAlignOptions>({
  name: "textAlign",

  addOptions() {
    return {
      types: ["paragraph", "heading"],
      alignments: ["left", "center", "right", "justify"]
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...this.options.types],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => {
              const alignment = element.style.textAlign as TextAlignValue | "";
              return this.options.alignments.includes(alignment as TextAlignValue) ? alignment : null;
            },
            renderHTML: (attributes) => {
              const alignment = attributes.textAlign as TextAlignValue | null;
              return alignment ? { style: `text-align: ${alignment}` } : {};
            }
          }
        }
      }
    ];
  },

  addCommands() {
    return {
      setTextAlign:
        (alignment) =>
        ({ commands }) => {
          if (!this.options.alignments.includes(alignment)) {
            return false;
          }

          return this.options.types.map((type) => commands.updateAttributes(type, { textAlign: alignment })).some(Boolean);
        },
      unsetTextAlign:
        () =>
        ({ commands }) =>
          this.options.types.map((type) => commands.resetAttributes(type, "textAlign")).some(Boolean)
    };
  }
});
