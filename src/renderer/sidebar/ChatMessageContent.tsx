import { parseChatMessageBlocks } from "./chat-message-format";

type ChatMessageContentProps = {
  readonly content: string;
  readonly rich?: boolean;
};

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      return <strong key={`${part}-${index}`}>{bold[1]}</strong>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function ChatMessageContent({ content, rich = false }: ChatMessageContentProps) {
  if (!rich) {
    return <div className="message-content">{content}</div>;
  }

  const blocks = parseChatMessageBlocks(content);
  if (blocks.length === 0) {
    return <div className="message-content rich-message" />;
  }

  return (
    <div className="message-content rich-message">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <div className="chat-rich-heading" key={`${block.type}-${index}`}>
              {renderInline(block.text)}
            </div>
          );
        }
        if (block.type === "orderedList") {
          return (
            <ol className="chat-rich-list" key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === "unorderedList") {
          return (
            <ul className="chat-rich-list" key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "draft") {
          return (
            <section className="chat-draft-result" key={`${block.type}-${index}`}>
              <div className="chat-draft-label">{block.label}</div>
              <div className="chat-draft-text">{renderInline(block.text)}</div>
            </section>
          );
        }
        if (block.type === "code") {
          return (
            <pre className="chat-rich-code" key={`${block.type}-${index}`}>
              <code>{block.text}</code>
            </pre>
          );
        }
        return (
          <p className="chat-rich-paragraph" key={`${block.type}-${index}`}>
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
