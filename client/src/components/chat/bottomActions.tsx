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

  const currentMode = isActor ? actorMode : guestMode;
  const inScenarioMode = currentMode === "scenario" || currentMode === "root";

  const currentChar = characters.get(currentCharacterId);
  const stickers = currentChar?.stickerPack || [];

  return (
    <div className="bottom-actions">
      {inScenarioMode && activeChoices && (
        <ChoicePanel choices={activeChoices} onSelect={onSelectChoice} />
      )}

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

      {!inScenarioMode && !isRoot && (
        <FreeInput onSend={onSendFreeMessage} stickers={stickers} />
      )}

      {isActor && !isRoot && (
        <ModeToggle
          currentMode={actorMode as "scenario" | "free"}
          onToggle={(mode) => onSwitchActorMode(mode)}
        />
      )}
    </div>
  );
}
