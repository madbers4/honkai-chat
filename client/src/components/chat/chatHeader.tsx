import { useState } from "react";
import { AdminMenu } from "../admin/adminMenu";
import type { CharacterDef, ScenarioVariant } from "../../types";

interface Props {
  role: string;
  characters: Map<string, CharacterDef>;
  currentCharacterId: string;
  onSwitchCharacter: (id: string) => void;
  onReset: () => void;
  onStartScenario: () => void;
  canStartScenario: boolean;
  isConnected: boolean;
  scenarioVariant: ScenarioVariant;
  onSwitchVariant: (variant: string) => void;
  noScenario: boolean;
  onToggleNoScenario: (enabled: boolean) => void;
}

export function ChatHeader({
  role,
  characters,
  currentCharacterId,
  onSwitchCharacter,
  onReset,
  onStartScenario,
  canStartScenario,
  isConnected,
  scenarioVariant,
  onSwitchVariant,
  noScenario,
  onToggleNoScenario,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="chat-header">
      <div className="chat-header__info">
        <div className="chat-header__title">Где исполняются мечты</div>
        <div className="chat-header__subtitle">
          Групповой чат съемочной группы.
          {!isConnected && (
            <span className="chat-header__offline"> • Нет связи</span>
          )}
        </div>
      </div>
      {role === "actor" && (
        <button
          className="chat-header__admin-trigger"
          onClick={() => setMenuOpen(true)}
        >
          ⋯
        </button>
      )}
      {menuOpen && (
        <AdminMenu
          characters={characters}
          currentCharacterId={currentCharacterId}
          onSwitchCharacter={(id) => {
            onSwitchCharacter(id);
            setMenuOpen(false);
          }}
          onReset={onReset}
          onStartScenario={onStartScenario}
          canStartScenario={canStartScenario}
          onClose={() => setMenuOpen(false)}
          scenarioVariant={scenarioVariant}
          onSwitchVariant={onSwitchVariant}
          noScenario={noScenario}
          onToggleNoScenario={onToggleNoScenario}
        />
      )}
    </div>
  );
}
