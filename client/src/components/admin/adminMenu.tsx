import { useState } from "react";
import { CharacterPicker } from "./characterPicker";
import type { CharacterDef } from "../../types";

interface Props {
  characters: Map<string, CharacterDef>;
  currentCharacterId: string;
  onSwitchCharacter: (id: string) => void;
  onReset: () => void;
  onStartScenario: () => void;
  canStartScenario: boolean;
  onClose: () => void;
}

export function AdminMenu({
  characters,
  currentCharacterId,
  onSwitchCharacter,
  onReset,
  onStartScenario,
  canStartScenario,
  onClose,
}: Props) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <div className="admin-overlay" onClick={onClose} />
      <div className="admin-menu fade-enter">
        <div className="admin-menu__section">
          <div className="admin-menu__section-title">Персонаж</div>
          <CharacterPicker
            characters={characters}
            currentCharacterId={currentCharacterId}
            onSelect={onSwitchCharacter}
          />
        </div>
        <div className="admin-menu__divider" />
        {canStartScenario && (
          <button
            className="admin-menu__start"
            onClick={() => {
              onStartScenario();
              onClose();
            }}
          >
            ▶ Запустить сценарий
          </button>
        )}
        <button
          className="admin-menu__reset"
          onClick={() => setShowConfirm(true)}
        >
          🔄 Сбросить
        </button>
      </div>
      {showConfirm && (
        <div className="confirm-dialog">
          <div
            className="confirm-dialog__overlay"
            onClick={() => setShowConfirm(false)}
          />
          <div className="confirm-dialog__card fade-enter">
            <div className="confirm-dialog__title">Сбросить чат?</div>
            <div className="confirm-dialog__text">
              Все сообщения будут удалены, сценарий начнётся заново.
            </div>
            <div className="confirm-dialog__actions">
              <button
                className="confirm-dialog__btn confirm-dialog__btn--cancel"
                onClick={() => setShowConfirm(false)}
              >
                Отмена
              </button>
              <button
                className="confirm-dialog__btn confirm-dialog__btn--confirm"
                onClick={() => {
                  onReset();
                  setShowConfirm(false);
                  onClose();
                }}
              >
                Сбросить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
