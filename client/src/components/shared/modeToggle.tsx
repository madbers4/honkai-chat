interface Props {
  currentMode: "scenario" | "free";
  onToggle: (mode: "scenario" | "free") => void;
}

export function ModeToggle({ currentMode, onToggle }: Props) {
  return (
    <div className="mode-toggle">
      <button
        className={`mode-toggle__option ${currentMode === "scenario" ? "mode-toggle__option--active" : ""}`}
        onClick={() => onToggle("scenario")}
      >
        Сценарий
      </button>
      <button
        className={`mode-toggle__option ${currentMode === "free" ? "mode-toggle__option--active" : ""}`}
        onClick={() => onToggle("free")}
      >
        Свободный
      </button>
    </div>
  );
}
