import "./TypingIndicator.css";

export default function TypingIndicator() {
  return (
    <div className="typing">
      <span className="typing__label">Travel Agent is thinking</span>
      <span className="typing__dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
