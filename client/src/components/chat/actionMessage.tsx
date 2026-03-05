interface Props {
  text: string;
}

export function ActionMessage({ text }: Props) {
  return (
    <div className="action-message message-enter">
      <span className="action-message__dash" />
      <span className="action-message__icon">◆</span>
      <span className="action-message__text">{text}</span>
      <span className="action-message__icon">◆</span>
      <span className="action-message__dash" />
    </div>
  );
}
