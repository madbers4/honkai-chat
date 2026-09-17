import type { Commentary, ReactionKind } from "./commentary";

function reactionMood(kind: ReactionKind) {
  if (["time15", "time45", "lastChance"].includes(kind))
    return { name: "СОБРАЛИСЬ", icon: "!", tone: "tense" };
  if (
    ["near", "flood", "streak", "comeback", "bonus", "support"].includes(kind)
  )
    return { name: "ЧАТ, СМОТРИТЕ", icon: "✦", tone: "hype" };
  if (["idleStart", "idle", "longIdle", "stalled"].includes(kind))
    return { name: "НА СВЯЗИ", icon: "…", tone: "waiting" };
  if (kind === "encore")
    return { name: "Я СПОКОЙНА", icon: "?!", tone: "tense" };
  return { name: "В ЭФИРЕ", icon: "♥", tone: "playful" };
}

export function LiveCommentary({ commentary }: { commentary: Commentary }) {
  const mood = reactionMood(commentary.kind);
  return (
    <aside
      className={`live-commentary mood-${mood.tone}`}
      aria-label="Комментарии Искры"
    >
      <div className="commentary-take" key={commentary.serial}>
        <div className="stream-camera" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}avatars/sparxie.png`} alt="" />
          <span className="camera-live">
            <i /> LIVE
          </span>
          <span className="camera-reaction">{mood.icon}</span>
        </div>
        <div className="commentary-caption">
          <div className="commentary-byline" aria-hidden="true">
            <span>
              ИСКРА <b>✦</b>
            </span>
            <span className="commentary-mood">{mood.name}</span>
            <span className="voice-bars">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <p role="status" aria-live="polite" aria-atomic="true">
            {commentary.text}
          </p>
        </div>
      </div>
    </aside>
  );
}
