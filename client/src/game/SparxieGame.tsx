import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { dialogue } from "./dialogue";
import {
  createGame,
  DURATION_MS,
  isActive,
  MAX_ATTEMPTS,
  remainingMs,
  transition,
  type Action,
  type Game,
  type Message,
} from "./game";
import { adjacentMines, MINE_COUNT, SIZE } from "./minesweeper";
import { parseGame, STORAGE_KEY } from "./storage";
import "./game.css";

function freshGame(): Game {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return createGame(
    `${Date.now().toString(36)}-${random[0].toString(36)}`,
    random[1],
  );
}

function loadGame(): Game {
  try {
    return parseGame(sessionStorage.getItem(STORAGE_KEY)) ?? freshGame();
  } catch {
    return freshGame();
  }
}

function timeLabel(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function useGame() {
  const [game, setGame] = useState(loadGame);
  const [now, setNow] = useState(Date.now);
  const [storageError, setStorageError] = useState(false);
  const current = useRef(game);

  const commit = useCallback((next: Game) => {
    current.current = next;
    setGame(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      const next = transition(current.current, action, Date.now());
      if (next !== current.current) commit(next);
      setNow(Date.now());
    },
    [commit],
  );

  useEffect(() => {
    dispatch({ type: "tick" });
    const timer = window.setInterval(() => dispatch({ type: "tick" }), 250);
    const wake = () => dispatch({ type: "tick" });
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [dispatch]);

  const restart = () => {
    if (current.current.phase === "won" || current.current.phase === "lost")
      commit(freshGame());
  };
  return { game, now, dispatch, restart, storageError };
}

function Avatar({ large = false }: { large?: boolean }) {
  return (
    <img
      className={`sparxie-avatar${large ? " large" : ""}`}
      src={`${import.meta.env.BASE_URL}avatars/sparxie.png`}
      alt="Искра"
    />
  );
}

function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div
      className="message-history"
      role="log"
      aria-label="Переписка"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.map((message) =>
        message.author === "system" ? (
          <p className="system-message" key={message.id}>
            {message.text}
          </p>
        ) : (
          <div className={`chat-message ${message.author}`} key={message.id}>
            {message.author === "sparxie" && <Avatar />}
            <div>
              <span className="message-author">
                {message.author === "sparxie" ? "Искра" : "Первопроходец"}
              </span>
              <p className="message-bubble">{message.text}</p>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function BoardView({
  game,
  dispatch,
}: {
  game: Game;
  dispatch: (action: Action) => void;
}) {
  const [flagMode, setFlagMode] = useState(false);
  const locked = game.phase !== "playing";
  useEffect(() => setFlagMode(false), [game.failedAttempts]);
  return (
    <section className="mine-panel" aria-label="Панель обезвреживания">
      <div className="panel-title">
        <span className="panel-icon" aria-hidden="true">
          ✳
        </span>
        <div>
          <span className="eyebrow">ВЛОЖЕНИЕ ОТ ИСКРЫ</span>
          <h2>Очень подозрительные клетки</h2>
        </div>
      </div>
      <div className="board-meta">
        <span>
          {MINE_COUNT} мины · поле {SIZE} × {SIZE}
        </span>
        <span>
          Открыто {game.board.revealed.length}/{SIZE * SIZE - MINE_COUNT}
        </span>
      </div>
      <div className="mode-switch" role="group" aria-label="Режим нажатия">
        <button
          type="button"
          aria-pressed={!flagMode}
          onClick={() => setFlagMode(false)}
        >
          ◇ Открыть
        </button>
        <button
          type="button"
          aria-pressed={flagMode}
          onClick={() => setFlagMode(true)}
        >
          ⚑ Флажок · {game.board.flags.length}/{MINE_COUNT}
        </button>
      </div>
      <div className="mine-grid" role="group" aria-label="Поле сапёра">
        {Array.from({ length: SIZE * SIZE }, (_, cell) => {
          const open = game.board.revealed.includes(cell);
          const flagged = game.board.flags.includes(cell);
          const exploded = game.board.exploded === cell;
          const mine = locked && game.board.mines.includes(cell);
          const count = open ? adjacentMines(game.board, cell) : 0;
          const description = exploded
            ? "взорванная мина"
            : mine
              ? "мина"
              : open
                ? `${count} мин рядом`
                : flagged
                  ? "флажок"
                  : "закрыта";
          return (
            <button
              key={cell}
              type="button"
              className={`mine-cell${open ? " open" : ""}${flagged ? " flagged" : ""}${mine ? " mine" : ""}${exploded ? " exploded" : ""}`}
              data-count={count}
              aria-label={`Ряд ${Math.floor(cell / SIZE) + 1}, столбец ${(cell % SIZE) + 1}: ${description}`}
              disabled={locked || open}
              onClick={() =>
                dispatch({ type: flagMode ? "flag" : "reveal", cell })
              }
              onContextMenu={(event) => {
                event.preventDefault();
                if (!locked) dispatch({ type: "flag", cell });
              }}
            >
              {mine ? (
                "✹"
              ) : flagged ? (
                "⚑"
              ) : open ? (
                count || <span className="empty-cell">·</span>
              ) : (
                <span className="closed-cell">◇</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="board-hint">
        {flagMode
          ? "Отмечай подозрительные клетки. Нажми на флажок ещё раз, чтобы убрать его."
          : "Цифра — число мин рядом, включая диагонали. Открой все безопасные клетки."}
      </p>
      {!game.board.mines.length && (
        <p className="safe-first">Первый ход безопасный. Даже Искра обещала.</p>
      )}
      <details className="game-help">
        <summary>Как играть?</summary>
        <p>
          Выбери любую клетку. Цифры показывают количество мин вокруг неё. Если
          рядом с «1» осталась только одна закрытая клетка, там мина. Отметь её
          флажком, остальные соседние клетки безопасны.
        </p>
        <p>
          Попадание на мину тратит одну попытку. После ошибки начни новое поле.
          Время общее, включая переписку: пять минут на всю историю.
        </p>
      </details>
    </section>
  );
}

function StaffPage() {
  const [url, setUrl] = useState(new URL("./", window.location.href).href);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setQr("");
    setError("");
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("protocol");
      QRCode.toDataURL(parsed.href, {
        width: 960,
        margin: 4,
        errorCorrectionLevel: "M",
      })
        .then((data) => {
          if (!cancelled) setQr(data);
        })
        .catch(() => {
          if (!cancelled)
            setError("Не удалось собрать QR. Проверь длину ссылки.");
        });
    } catch {
      setError("Вставь полный адрес игры, начиная с https:// или http://.");
    }
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <main className="staff-page">
      <a href="./" className="back-link">
        ← К игре
      </a>
      <p className="eyebrow">ФОНТЕЙНКА · ДЛЯ СТЕНДОВИКОВ</p>
      <h1>QR на бомбу</h1>
      <p>
        Гость сканирует код, входит в эфир Искры и начинает собственную игру.
        Ведущий в чате не нужен.
      </p>
      <label className="url-label">
        Адрес игры
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          spellCheck={false}
        />
      </label>
      <p className="staff-note">
        Для печати укажи публичный адрес сайта. Ссылка с localhost работает
        только на этом компьютере.
      </p>
      {error && <p role="alert">{error}</p>}
      {qr && (
        <div className="qr-poster">
          <p className="eyebrow">ИСКРА ПРИГЛАШАЕТ В ЭФИР</p>
          <h2>
            Не трогай бомбу.
            <br />
            Лучше открой чат.
          </h2>
          <img src={qr} alt="QR-код входа в игру с Искрой" />
          <p>5 минут · 5 попыток · одна очень довольная Искра</p>
          <a
            href={qr}
            download="constanta-sparxie-qr.png"
            className="primary-button"
          >
            Скачать QR-код
          </a>
        </div>
      )}
      <div className="staff-rules">
        <h2>На площадке</h2>
        <p>
          Отправь гостя к реквизиту с QR. Отсчёт начнётся после кнопки «Войти в
          эфир», а обновление страницы продолжит ту же партию. Каждая вкладка
          играет отдельно; закрытие вкладки завершает её сессию.
        </p>
        <p>
          После финала гость показывает экран и получает печать. Если время или
          попытки закончились, бомба в истории взрывается конфетти. Следующую
          игру можно начать с экрана результата.
        </p>
        <p>Телефон не снимает гостя: «эфир» и его зрители — часть сюжета.</p>
      </div>
    </main>
  );
}

function GuestPage() {
  const { game, now, dispatch, restart, storageError } = useGame();
  const viewport = useRef<HTMLDivElement>(null);
  const previousPhase = useRef<Game["phase"]>("welcome");
  const time = remainingMs(game, now);
  const active = isActive(game);
  const finished = game.phase === "won" || game.phase === "lost";
  const hasBoard =
    game.phase === "playing" ||
    game.phase === "retry" ||
    (finished && game.board.mines.length > 0);

  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    if (game.phase === "playing" && previousPhase.current !== "playing") {
      container
        .querySelector(".mine-panel")
        ?.scrollIntoView({ block: "start" });
    } else if (
      game.phase === "retry" ||
      finished ||
      game.phase === "dialogue"
    ) {
      container.scrollTop = container.scrollHeight;
    }
    previousPhase.current = game.phase;
  }, [game.messages.length, game.phase, finished]);

  return (
    <main
      className={`game-layout${game.phase === "lost" ? " has-exploded" : ""}`}
    >
      <aside className="show-sidebar">
        <a className="stand-brand" href="./">
          ФОНТЕЙНКА<span>НА CONstanta</span>
        </a>
        <div className="show-intro">
          <p className="eyebrow">ПЕНАКОНИЯ · ЛЕТНИЙ СПЕЦВЫПУСК</p>
          <h1>
            Этот эфир
            <br />
            будет <em>взрывным.</em>
          </h1>
          <p>
            Первопроходец, бомба и ведущая,
            <br />
            которая слишком довольна собой.
          </p>
        </div>
        <div className="show-art">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="art-suit suit-one">♠</span>
          <span className="art-suit suit-two">♥</span>
          <Avatar large />
          <span className="art-tag">Искра уже в чате ↗</span>
        </div>
        <div className="episode-info">
          <span>
            05:00<small>до финала</small>
          </span>
          <span>
            05<small>попыток</small>
          </span>
          <span>
            01<small>главный герой. ты.</small>
          </span>
        </div>
        <footer>
          Honkai: Star Rail · фан-активность
          <a href="./?staff=1">QR для стенда ↗</a>
        </footer>
      </aside>

      <section className="chat-shell" aria-label="Чат с Искрой">
        <header className="stream-header">
          <Avatar />
          <div className="stream-person">
            <h2>
              Искра <span aria-label="Проверенная ведущая">✦</span>
            </h2>
            <p>
              {finished ? "Эфир завершён" : "Сюжетный эфир · летний коллаб"}
            </p>
          </div>
          <span className={`live-badge${finished ? " offline" : ""}`}>
            <i />
            {finished ? "OFF" : "LIVE"}
          </span>
        </header>

        <div
          className={`mission-bar${active && time <= 60000 ? " urgent" : ""}`}
        >
          <div>
            <span className="eyebrow">
              {game.phase === "won"
                ? "ОБЕЗВРЕЖЕНО"
                : game.phase === "lost"
                  ? "ФИНАЛ ЭФИРА"
                  : "ДО ВЗРЫВА"}
            </span>
            <strong aria-label={`Осталось ${timeLabel(time)}`}>
              {timeLabel(time)}
            </strong>
          </div>
          <div className="attempts">
            <span className="eyebrow">ПОПЫТКИ</span>
            <span
              className="attempt-dots"
              aria-label={`Осталось попыток: ${MAX_ATTEMPTS - game.failedAttempts}`}
            >
              {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
                <i key={i} className={i < game.failedAttempts ? "spent" : ""} />
              ))}
              <b>
                {MAX_ATTEMPTS - game.failedAttempts}/{MAX_ATTEMPTS}
              </b>
            </span>
          </div>
        </div>
        <div className="timer-track" aria-hidden="true">
          <span style={{ width: `${(time / DURATION_MS) * 100}%` }} />
        </div>

        {storageError && (
          <p className="storage-warning" role="status">
            Браузер не сохраняет прогресс. Оставь эту вкладку открытой до конца
            игры.
          </p>
        )}
        <div className="chat-viewport" ref={viewport}>
          {game.phase === "welcome" ? (
            <div className="welcome-card">
              <div className="welcome-icon">♥</div>
              <p className="eyebrow">ВАМ ПРИШЛО ПРИГЛАШЕНИЕ</p>
              <h2>
                Первопроходец,
                <br />
                ты как раз вовремя.
              </h2>
              <p>
                На съёмочной площадке нашли бомбу.
                <br />
                На бомбе — QR. За QR — Искра.
                <br />
                Совпадение? Ей бы понравилось.
              </p>
              <div className="welcome-rules">
                <span>01</span>
                <p>Поговори с Искрой. Выбирай ответы — она всё запоминает.</p>
                <span>02</span>
                <p>
                  Пройди маленького «Сапёра» прямо в чате. У тебя пять попыток.
                </p>
                <span>03</span>
                <p>
                  Уложись в пять минут вместе с перепиской. Покажи финал
                  стендовику.
                </p>
              </div>
              <button
                className="primary-button"
                onClick={() => dispatch({ type: "start" })}
              >
                Войти в эфир <span>↗</span>
              </button>
              <small>
                Таймер начнётся после входа.
                <br />
                Эфир — часть игры, камера не включается.
              </small>
            </div>
          ) : (
            <>
              <p className="chat-date">СЕГОДНЯ · ПРЯМО СО СЪЁМОЧНОЙ ПЛОЩАДКИ</p>
              <MessageList
                messages={
                  game.boardMessageIndex === null
                    ? game.messages
                    : game.messages.slice(0, game.boardMessageIndex)
                }
              />
              {hasBoard && <BoardView game={game} dispatch={dispatch} />}
              {game.boardMessageIndex !== null && (
                <MessageList
                  messages={game.messages.slice(game.boardMessageIndex)}
                />
              )}
              {game.phase === "retry" && (
                <div className="retry-card">
                  <p>Мина найдена. Совсем не тем способом.</p>
                  <button
                    className="primary-button"
                    onClick={() => dispatch({ type: "retry" })}
                  >
                    Попытка {game.failedAttempts + 1} из {MAX_ATTEMPTS}{" "}
                    <span>↻</span>
                  </button>
                  <small>Таймер продолжает идти.</small>
                </div>
              )}
              {finished && (
                <section
                  className={`result-card ${game.phase}`}
                  aria-label="Результат игры"
                >
                  <div className="result-symbol" aria-hidden="true">
                    {game.phase === "won" ? "✦" : "✹"}
                  </div>
                  <p className="eyebrow">ЭФИР ЗАВЕРШЁН</p>
                  <h2>
                    {game.phase === "won"
                      ? "Площадка спасена!"
                      : "Взрывной контент."}
                  </h2>
                  <p>
                    {game.phase === "won"
                      ? "Ты обезвредил бомбу и лишил Искру спецэффектов. Зато обеспечил ей хороший финал."
                      : game.lossReason === "time"
                        ? "Пять минут прошли — бомба взорвалась конфетти. Искра уже придумывает заголовок."
                        : "Все пять попыток потрачены. Бомба взорвалась конфетти, а ты вошёл в историю этого эфира."}
                  </p>
                  <div className="stamp-note">
                    Покажи этот экран стендовику
                    <br />
                    <strong>и забери печать за Пенаконию.</strong>
                  </div>
                  <span className="round-number">
                    Эфир № {game.id.slice(-6).toUpperCase()}
                  </span>
                  <button className="secondary-button" onClick={restart}>
                    Начать новую игру
                  </button>
                </section>
              )}
            </>
          )}
        </div>

        {game.phase === "dialogue" && (
          <div className="reply-panel">
            <p className="eyebrow">ПЕРВОПРОХОДЕЦ · ТВОЙ ОТВЕТ</p>
            <div key={game.node}>
              {dialogue[game.node].replies.map((reply, index) => (
                <button
                  key={index}
                  onClick={() =>
                    dispatch({ type: "reply", node: game.node, index })
                  }
                >
                  <span>{reply.text}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {game.phase === "playing" && (
          <div className="playing-footer">
            <span className="live-dot" /> Искра наблюдает за каждым ходом.
          </div>
        )}
      </section>
    </main>
  );
}

export function SparxieGame() {
  return window.location.pathname.replace(/\/$/, "").endsWith("/actor") ||
    new URLSearchParams(window.location.search).get("staff") === "1" ? (
    <StaffPage />
  ) : (
    <GuestPage />
  );
}
