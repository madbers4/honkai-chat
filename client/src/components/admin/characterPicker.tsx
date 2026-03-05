import type { CharacterDef } from "../../types";

interface Props {
  characters: Map<string, CharacterDef>;
  currentCharacterId: string;
  onSelect: (id: string) => void;
}

export function CharacterPicker({
  characters,
  currentCharacterId,
  onSelect,
}: Props) {
  const characterItems = Array.from(characters.values());

  return (
    <div className="character-picker">
      {/* Root pseudo-character */}
      <button
        className={`character-picker__item ${currentCharacterId === "root" ? "character-picker__item--active" : ""}`}
        onClick={() => onSelect("root")}
      >
        <div className="character-picker__emoji">🔧</div>
        <span className="character-picker__name">Root</span>
      </button>
      {/* Actual characters */}
      {characterItems.map((char) => (
        <button
          key={char.id}
          className={`character-picker__item ${char.id === currentCharacterId ? "character-picker__item--active" : ""}`}
          onClick={() => onSelect(char.id)}
        >
          <div className="character-picker__avatar">
            <img src={char.avatarUrl} alt={char.name} />
          </div>
          <span className="character-picker__name">{char.name}</span>
        </button>
      ))}
    </div>
  );
}
