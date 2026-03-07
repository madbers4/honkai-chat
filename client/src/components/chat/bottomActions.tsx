import { ChoicePanel } from "./choicePanel";
import { FreeInput } from "./freeInput";
import { ModeToggle } from "../shared/modeToggle";
import type {
  ActiveChoice,
  CharacterDef,
  GuestMode,
  ActorMode,
} from "../../types";

interface Props {
  role: string;
  activeChoices: ActiveChoice | null;
  guestMode: GuestMode;
  actorMode: ActorMode;
  currentCharacterId: string;
  characters: Map<string, CharacterDef>;
  onSelectChoice: (optionId: string, stepIndex: number) => void;
  onSendFreeMessage: (type: "text" | "img" | "sticker", value: string) => void;
  onSwitchActorMode: (mode: ActorMode) => void;
  onAdvanceScenario: () => void;
}

export function BottomActions({
  role,
  activeChoices,
  guestMode,
  actorMode,
  currentCharacterId,
  characters,
  onSelectChoice,
  onSendFreeMessage,
  onSwitchActorMode,
  onAdvanceScenario,
}: Props) {
  const isRoot = currentCharacterId === "root";
  const isActor = role === "actor";
  const isGuest = role === "guest";

  // Free chat is allowed only when guestMode is 'free' (applies to EVERYONE)
  const isFreePhase = guestMode === "free";

  const currentChar = characters.get(currentCharacterId);
  const stickers = currentChar?.stickerPack || [];

  return (
    <div className="bottom-actions">
      {/* Choices are visible to anyone who receives them (guest or targeted actor) */}
      {activeChoices && (
        <ChoicePanel choices={activeChoices} onSelect={onSelectChoice} />
      )}

      {/* Root always has advance button when no choices pending */}
      {isRoot && !activeChoices && (
        <div className="choice-panel">
          <button
            className="choice-button choice-button--advance"
            onClick={onAdvanceScenario}
          >
            ▶ Продолжить сценарий
          </button>
        </div>
      )}

      {/* Free input only during free phase, not for root */}
      {isFreePhase && !isRoot && (
        <FreeInput onSend={onSendFreeMessage} stickers={stickers} />
      )}

      {/* Mode toggle for actor (not root) during free phase only */}
      {isActor && !isRoot && isFreePhase && (
        <ModeToggle
          currentMode={actorMode as "scenario" | "free"}
          onToggle={(mode) => onSwitchActorMode(mode)}
        />
      )}
    </div>
  );
}
