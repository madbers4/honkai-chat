import { useState } from "react";
import { ChoicePanel } from "./choicePanel";
import { FreeInput } from "./freeInput";
import type {
  ActiveChoice,
  CharacterDef,
  GuestMode,
  PendingAdvance,
} from "../../types";

interface Props {
  role: string;
  activeChoices: ActiveChoice | null;
  pendingAdvance: PendingAdvance | null;
  guestMode: GuestMode;
  currentCharacterId: string;
  characters: Map<string, CharacterDef>;
  onSelectChoice: (optionId: string, stepIndex: number) => void;
  onSendFreeMessage: (type: "text" | "img" | "sticker", value: string) => void;
  onAdvanceScenario: () => void;
  noScenario: boolean;
}

export function BottomActions({
  role,
  activeChoices,
  pendingAdvance,
  guestMode,
  currentCharacterId,
  characters,
  onSelectChoice,
  onSendFreeMessage,
  onAdvanceScenario,
  noScenario,
}: Props) {
  const isRoot = currentCharacterId === "root";
  const isActor = role === "actor";

  // Free chat is allowed when guestMode is 'free' OR noScenario mode is active
  const isFreePhase = guestMode === "free" || noScenario;

  const currentChar = characters.get(currentCharacterId);
  const stickers = currentChar?.stickerPack || [];

  // Action dialog state
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [pendingChoiceData, setPendingChoiceData] = useState<{
    optionId: string;
    stepIndex: number;
    label: string;
  } | null>(null);

  // Choices visibility — client-side filtering (hidden in noScenario mode)
  const showChoices =
    !noScenario &&
    activeChoices !== null &&
    (isRoot ||
      (activeChoices.target === "guest" && role === "guest") ||
      (activeChoices.target === "actor" &&
        isActor &&
        activeChoices.targetCharacterId === currentCharacterId));

  // Show advance button based on pendingAdvance target (hidden in noScenario mode)
  const showAdvance =
    !noScenario &&
    pendingAdvance !== null &&
    !activeChoices &&
    (pendingAdvance.target === "guest"
      ? role === "guest" || isRoot
      : isActor &&
        (pendingAdvance.characterId === currentCharacterId || isRoot));

  const handleChoiceSelect = (optionId: string, stepIndex: number) => {
    if (isFreePhase) {
      const label =
        activeChoices?.options.find((o) => o.id === optionId)?.label ?? "";
      setPendingChoiceData({ optionId, stepIndex, label });
      setShowActionDialog(true);
    } else {
      onSelectChoice(optionId, stepIndex);
    }
  };

  const handleAdvanceClick = () => {
    if (isFreePhase) {
      setShowActionDialog(true);
    } else {
      onAdvanceScenario();
    }
  };

  const handleConfirmAction = () => {
    setShowActionDialog(false);
    if (pendingChoiceData) {
      onSelectChoice(pendingChoiceData.optionId, pendingChoiceData.stepIndex);
      setPendingChoiceData(null);
    } else {
      onAdvanceScenario();
    }
  };

  const handleCancelAction = () => {
    setShowActionDialog(false);
    setPendingChoiceData(null);
  };

  return (
    <div className="bottom-actions">
      {/* Choices — visibility determined by role + target */}
      {showChoices && activeChoices && (
        <ChoicePanel choices={activeChoices} onSelect={handleChoiceSelect} />
      )}

      {/* Advance button for the character who has pending actions */}
      {showAdvance && (
        <div className="choice-panel">
          <button
            className="choice-button choice-button--advance"
            onClick={handleAdvanceClick}
          >
            ▶ Продолжить сценарий
          </button>
        </div>
      )}

      {/* Action confirmation dialog */}
      {showActionDialog && (
        <div className="action-dialog-overlay" onClick={handleCancelAction}>
          <div className="action-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="action-dialog__title">Подтвердите действие</div>
            <div className="action-dialog__text">
              {pendingChoiceData
                ? pendingChoiceData.label
                : pendingAdvance?.actionText}
            </div>
            <div className="action-dialog__buttons">
              <button
                className="action-dialog__btn action-dialog__btn--cancel"
                onClick={handleCancelAction}
              >
                Отмена
              </button>
              <button
                className="action-dialog__btn action-dialog__btn--confirm"
                onClick={handleConfirmAction}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Free input only during free phase, not for root */}
      {isFreePhase && !isRoot && (
        <FreeInput onSend={onSendFreeMessage} stickers={stickers} />
      )}
    </div>
  );
}
