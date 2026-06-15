import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./ChatMessage.css";

export default function ChatMessage({ role, content }) {
  return (
    <div className={`message message--${role}`}>
      <span className="message__label">
        {role === "user" ? "You" : "Travel Agent"}
      </span>
      <div className="message__bubble">
        {role === "assistant" ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {typeof content === "string" ? content : String(content ?? "")}
          </ReactMarkdown>
        ) : (
          <p>{content}</p>
        )}
      </div>
    </div>
  );
}
