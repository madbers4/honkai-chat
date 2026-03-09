import { useState } from "react";
import { CharacterPicker } from "./characterPicker";
import type { CharacterDef, ScenarioVariant } from "../../types";
import { scenarioVariantLabels, scenarioVariants } from "@honkai-chat/shared";

interface Props {
  characters: Map<string, CharacterDef>;
  currentCharacterId: string;
  onSwitchCharacter: (id: string) => void;
  onReset: () => void;
  onStartScenario: () => void;
  canStartScenario: boolean;
  onClose: () => void;
  scenarioVariant: ScenarioVariant;
  onSwitchVariant: (variant: string) => void;
  noScenario: boolean;
  onToggleNoScenario: (enabled: boolean) => void;
}

export function AdminMenu({
  characters,
  currentCharacterId,
  onSwitchCharacter,
  onReset,
  onStartScenario,
  canStartScenario,
  onClose,
  scenarioVariant,
  onSwitchVariant,
  noScenario,
  onToggleNoScenario,
}: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showVariantConfirm, setShowVariantConfirm] =
    useState<ScenarioVariant | null>(null);

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
        <div className="admin-menu__section">
          <div className="admin-menu__section-title">Версия сценария</div>
          <div className="variant-picker">
            {scenarioVariants.map((v) => (
              <button
                key={v}
                className={`variant-picker__item ${v === scenarioVariant ? "variant-picker__item--active" : ""}`}
                onClick={() => {
                  if (v !== scenarioVariant) {
                    setShowVariantConfirm(v);
                  }
                }}
              >
                {scenarioVariantLabels[v]}
              </button>
            ))}
          </div>
        </div>
        <div className="admin-menu__divider" />
        <button
          className={`admin-menu__no-scenario ${noScenario ? "admin-menu__no-scenario--active" : ""}`}
          onClick={() => {
            onToggleNoScenario(!noScenario);
          }}
        >
          {noScenario ? "📝 Без сценария (вкл)" : "📝 Без сценария"}
        </button>
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
      {showVariantConfirm && (
        <div className="confirm-dialog">
          <div
            className="confirm-dialog__overlay"
            onClick={() => setShowVariantConfirm(null)}
          />
          <div className="confirm-dialog__card fade-enter">
            <div className="confirm-dialog__title">Сменить сценарий?</div>
            <div className="confirm-dialog__text">
              Сценарий будет переключён на «
              {scenarioVariantLabels[showVariantConfirm]}». Все сообщения будут
              удалены, сценарий начнётся заново (ожидание гостя).
            </div>
            <div className="confirm-dialog__actions">
              <button
                className="confirm-dialog__btn confirm-dialog__btn--cancel"
                onClick={() => setShowVariantConfirm(null)}
              >
                Отмена
              </button>
              <button
                className="confirm-dialog__btn confirm-dialog__btn--confirm-variant"
                onClick={() => {
                  onSwitchVariant(showVariantConfirm);
                  setShowVariantConfirm(null);
                  onClose();
                }}
              >
                Переключить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
