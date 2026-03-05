import type { ActiveChoice } from "../../types";

interface Props {
  choices: ActiveChoice;
  onSelect: (optionId: string, stepIndex: number) => void;
}

export function ChoicePanel({ choices, onSelect }: Props) {
  return (
    <div className="choice-panel">
      {choices.options.map((option) => (
        <button
          key={option.id}
          className="choice-button"
          onClick={() => onSelect(option.id, choices.stepIndex)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
