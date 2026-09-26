import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import QRCode from "qrcode";
import { dialogue } from "./dialogue";
import {
  createGame,
  attemptLimit,
  BONUS_MS,
  isActive,
  remainingMs,
  transition,
  type Action,
  type Game,
  type Message,
} from "./game";
import { adjacentMines } from "./minesweeper";
import {
  difficulties,
  difficultyDuration,
  difficultyTimeLabel,
} from "./difficulty";
import { parseGame, STORAGE_KEY } from "./storage";
import { LiveCommentary } from "./LiveCommentary";
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

function MessageList({
  messages,
  board,
  boardMessageIndex,
}: {
  messages: Message[];
  board?: ReactNode;
  boardMessageIndex: number | null;
}) {
  return (
    <div
      className="message-history"
      role="log"
      aria-label="Переписка"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.flatMap((message, index) => [
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
        index + 1 === boardMessageIndex ? (
          <div className="board-slot" key="game-board">
            {board}
          </div>
        ) : null,
      ])}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      className="chat-message sparxie typing-message"
      role="status"
      aria-label="Искра печатает"
    >
      <Avatar />
      <div>
        <span className="message-author">Искра печатает</span>
        <div className="message-bubble typing-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
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
  const frame = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const help = useRef<HTMLDetailsElement>(null);
  const [layout, setLayout] = useState<{ square?: number; showTips: boolean }>({
    showTips: false,
  });
  const tipsHeight = 60;
  const locked = !isActive(game);
  const { size, mineCount } = game.board;
  useEffect(() => setFlagMode(false), [game.failedAttempts, game.difficulty]);
  useLayoutEffect(() => {
    if (locked || !frame.current || !panel.current) {
      setLayout({ showTips: true });
      return;
    }
    const element = frame.current;
    const card = panel.current;
    const viewport = card.closest<HTMLElement>(".chat-viewport")!;
    const outerHeight = (element: Element) => {
      const css = getComputedStyle(element);
      return (
        element.getBoundingClientRect().height +
        parseFloat(css.marginTop) +
        parseFloat(css.marginBottom)
      );
    };
    const verticalInsets = (element: Element) => {
      const css = getComputedStyle(element);
      return [
        css.paddingTop,
        css.paddingBottom,
        css.borderTopWidth,
        css.borderBottomWidth,
      ].reduce((sum, value) => sum + parseFloat(value), 0);
    };
    const fit = () => {
      const available =
        viewport.clientHeight -
        verticalInsets(viewport) -
        verticalInsets(card) -
        outerHeight(card.querySelector(".board-meta")!) -
        outerHeight(card.querySelector(".mode-switch")!) -
        3;
      const preferred = Math.min(element.clientWidth, 360);
      const showTips = available >= preferred + tipsHeight;
      const minimum = size * 26 + (size - 1) * 3;
      const square = Math.max(
        minimum,
        Math.floor(
          Math.min(preferred, available - (showTips ? tipsHeight : 0)),
        ),
      );
      setLayout((previous) =>
        previous.square === square && previous.showTips === showTips
          ? previous
          : { square, showTips },
      );
    };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver((entries) => {
      if (
        entries.some((entry) => entry.target === viewport) ||
        element.clientWidth !== width
      ) {
        width = element.clientWidth;
        fit();
      }
    });
    observer.observe(viewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [locked, size]);
  useLayoutEffect(() => {
    // A resize can grow the board after the viewport has already scrolled.
    if (!locked) panel.current?.scrollIntoView({ block: "start" });
  }, [locked, layout.square, layout.showTips]);
  // Свернуть подсказку перед следующим раундом, сохранив режим флажков при бонусе.
  useEffect(() => {
    if (!locked && help.current) help.current.open = false;
  }, [locked]);
  return (
    <section
      className="mine-panel"
      aria-label="Панель обезвреживания"
      ref={panel}
    >
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
          {difficulties[game.difficulty].label} · {size} × {size}
        </span>
        <span>
          Открыто {game.board.revealed.length}/{size * size - mineCount}
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
          ⚑ Флажок · {game.board.flags.length}/{mineCount}
        </button>
      </div>
      <div className="board-frame" ref={frame}>
        <div
          className="mine-grid"
          role="group"
          aria-label="Поле сапёра"
          style={{
            gridTemplateColumns: `repeat(${size}, 1fr)`,
            width: layout.square,
            height: layout.square,
          }}
        >
          {Array.from({ length: size * size }, (_, cell) => {
            const open = game.board.revealed.includes(cell);
            const flagged = game.board.flags.includes(cell);
            const exploded = game.board.exploded === cell;
            const mine =
              (game.phase === "retry" ||
                game.phase === "lost" ||
                game.phase === "won") &&
              game.board.mines.includes(cell);
            const count = open ? adjacentMines(game.board, cell) : 0;
            const description = exploded
              ? "[ПИП] мина"
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
                aria-label={`Ряд ${Math.floor(cell / size) + 1}, столбец ${(cell % size) + 1}: ${description}`}
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
      </div>
      <div
        className="board-tips"
        hidden={!locked && !layout.showTips}
        style={{ height: tipsHeight }}
      >
        <p className="board-hint">
          {flagMode
            ? "Подозреваешь мину — поставь флажок. Повторное нажатие снимет его."
            : "Цифры — мины рядом, включая диагонали. Открой все безопасные клетки."}
        </p>
        <p className="safe-first">
          {game.board.mines.length
            ? "Флажки сами по себе не дают победу."
            : "Первый ход безопасный."}
        </p>
      </div>
      <details className="game-help" ref={help}>
        <summary aria-label="Как играть?">
          <span>Как играть?</span>
          <span className="first-move-note">Первый ход безопасный</span>
        </summary>
        <p className="board-hint">
          {flagMode
            ? "Отмечай подозрительные клетки. Нажми на флажок ещё раз, чтобы убрать его."
            : "Цифра — число мин рядом, включая диагонали. Открой все безопасные клетки."}
        </p>

        <p>
          Выбери любую клетку. Цифры показывают количество мин вокруг неё. Если
          рядом с «1» осталась только одна закрытая клетка, там мина. Отметь её
          флажком, остальные соседние клетки безопасны.
        </p>
        <p>
          Попадание на мину тратит одну попытку. После ошибки начни новое поле.
          На этом уровне {difficultyTimeLabel(game.difficulty)}: во время
          переписки и между попытками таймер стоит. Если не успеешь, Искра один
          раз добавит минуту и попытку.
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
      <h1>QR на сундучок</h1>
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
            Сундучок молчит.
            <br />
            Искра — нет.
          </h2>
          <img src={qr} alt="QR-код входа в игру с Искрой" />
          <p>3–5 минут · 5 попыток · одна очень довольная Искра</p>
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
          Отправь гостя к маленькому деревянному сундучку, обмотанному
          изолентой, с QR-кодом. Переписка без таймера. На лёгком уровне — три
          минуты, на среднем — четыре, на сложном — пять. Отсчёт начинается при
          открытии первого сапёра и идёт только на активном поле. Между
          попытками и во время реплик таймер стоит. По окончании времени Искра
          один раз добавит минуту и попытку. Обновление страницы продолжит ту же
          партию. Каждая вкладка играет отдельно; закрытие вкладки завершает её
          сессию.
        </p>
        <p>
          После финала гость показывает экран и получает печать. Если время или
          попытки закончились, [ПИП] в истории срабатывает — раунд проигран.
          Следующую игру можно начать с экрана результата. Сложность гость
          выбирает в диалоге: 5 × 5 / 4 мины, 6 × 6 / 7 мин или 7 × 7 / 10 мин.
          При победе с первой попытки быстрее минуты Искра один раз повышает
          сложность и требует реванш. За новый уровень добавляется минута;
          потраченное время и попытки сохраняются.
        </p>
        <p>Телефон не снимает гостя: «эфир» и его зрители — часть сюжета.</p>
      </div>
    </main>
  );
}

function StreamInvitation({ onJoin }: { onJoin: () => void }) {
  return (
    <main className="stream-entry">
      <header className="entry-brand">
        <span>ФОНТЕЙНКА</span>
        <span className="entry-cross">×</span>
        <span>CONstanta</span>
      </header>
      <div className="entry-stage" aria-hidden="true">
        <div className="entry-glow" />
        <div className="entry-orbit" />
        <img
          className="entry-portrait"
          src={`${import.meta.env.BASE_URL}images/sparxie-portrait.png`}
          alt=""
          fetchPriority="high"
        />
        <span className="entry-star entry-star-one">✦</span>
        <span className="entry-star entry-star-two">✦</span>
      </div>
      <section className="entry-content" aria-labelledby="entry-title">
        <span className="entry-live">
          <i /> LIVE <span>ПЕНАКОНИЯ</span>
        </span>
        <h1 id="entry-title">
          Искра
          <br />
          <em>в эфире.</em>
          <span className="entry-heart" aria-hidden="true">
            ♥
          </span>
        </h1>
        <p>Тебя как раз не хватало.</p>
        <button className="entry-join" onClick={onJoin}>
          <span className="entry-play" aria-hidden="true">
            ▶
          </span>
          Войти на стрим
          <span className="entry-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </section>
      <footer className="entry-footer">
        <span>ЛЕТНИЙ КОЛЛАБ</span>
        <span aria-hidden="true">✦</span>
        <span>HONKAI: STAR RAIL</span>
      </footer>
    </main>
  );
}

function GuestPage() {
  const { game, now, dispatch, restart, storageError } = useGame();
  const viewport = useRef<HTMLDivElement>(null);
  const wasActive = useRef(false);
  const time = remainingMs(game, now);
  const active = isActive(game);
  const attempts = attemptLimit(game);
  const finished = game.phase === "won" || game.phase === "lost";
  const ready = game.pending.length === 0;
  const typing = !ready && game.typingAt !== null && now >= game.typingAt;
  const hasBoard = game.boardMessageIndex !== null;

  useLayoutEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const fit = () => {
      if (active)
        container
          .querySelector(".mine-panel")
          ?.scrollIntoView({ block: "start" });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, game.phase === "welcome"]);

  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    if (active && !wasActive.current) {
      container
        .querySelector(".mine-panel")
        ?.scrollIntoView({ block: "start" });
    } else if (!active) {
      container.scrollTop = container.scrollHeight;
    }
    wasActive.current = active;
  }, [game.messages.length, game.phase, active, typing, ready]);

  if (game.phase === "welcome") {
    return <StreamInvitation onJoin={() => dispatch({ type: "start" })} />;
  }

  return (
    <main
      className={`game-layout${active ? " is-playing" : ""}${game.startedAt !== null ? " has-started" : ""}${game.phase === "lost" ? " has-exploded" : ""}`}
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
            будет <em>[ПИП].</em>
          </h1>
          <p>
            Первопроходец, сундучок и ведущая,
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
            {timeLabel(difficultyDuration(game.difficulty))}
            <small>на этот уровень</small>
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
            <p>{finished ? "Эфир завершён" : "Летний коллаб · Пенакония"}</p>
          </div>
          <span className={`live-badge${finished ? " offline" : ""}`}>
            <i />
            {finished ? "OFF" : "LIVE"}
          </span>
        </header>

        {game.startedAt !== null && (
          <>
            <div
              className={`mission-bar${active && time <= 60000 ? " urgent" : ""}`}
            >
              <div>
                <span className="eyebrow">
                  {game.phase === "won"
                    ? "ОБЕЗВРЕЖЕНО"
                    : game.phase === "lost"
                      ? "ФИНАЛ ЭФИРА"
                      : !active
                        ? "ПАУЗА"
                        : game.bonusGranted
                          ? "ШАНС ОТ ИСКРЫ"
                          : "ДО [ПИП]"}
                </span>
                <strong aria-label={`Осталось ${timeLabel(time)}`}>
                  {timeLabel(time)}
                </strong>
              </div>
              <div className="attempts">
                <span className="eyebrow">ПОПЫТКИ</span>
                <span
                  className="attempt-dots"
                  aria-label={`Осталось попыток: ${attempts - game.failedAttempts}`}
                >
                  {Array.from({ length: attempts }, (_, i) => (
                    <i
                      key={i}
                      className={i < game.failedAttempts ? "spent" : ""}
                    />
                  ))}
                  <b>
                    {attempts - game.failedAttempts}/{attempts}
                  </b>
                </span>
              </div>
            </div>
            <div className="timer-track" aria-hidden="true">
              <span
                style={{
                  width: `${(time / (game.bonusGranted ? BONUS_MS : difficultyDuration(game.difficulty))) * 100}%`,
                }}
              />
            </div>
          </>
        )}
        {game.bonusGranted && !finished && (
          <p className="bonus-notice" role="status">
            ♥ Искра дарит +1 минуту и +1 попытку.
          </p>
        )}

        {storageError && (
          <p className="storage-warning" role="status">
            Браузер не сохраняет прогресс. Оставь эту вкладку открытой до конца
            игры.
          </p>
        )}
        <div className="chat-viewport" ref={viewport}>
          <>
            <p className="chat-date">СЕГОДНЯ · ПРЯМО СО СЪЁМОЧНОЙ ПЛОЩАДКИ</p>
            <MessageList
              messages={game.messages}
              boardMessageIndex={game.boardMessageIndex}
              board={
                hasBoard ? (
                  <BoardView game={game} dispatch={dispatch} />
                ) : undefined
              }
            />
            {typing && <TypingIndicator />}
            {game.phase === "retry" && ready && (
              <div className="retry-card">
                <p>Мина найдена. Совсем не тем способом.</p>
                <button
                  className="primary-button"
                  onClick={() => dispatch({ type: "retry" })}
                >
                  Попытка {game.failedAttempts + 1} из {attempts} <span>↻</span>
                </button>
                <small>Время на паузе. Искра ждёт твоего возвращения.</small>
              </div>
            )}
            {finished && ready && (
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
                    : "[ПИП] контент."}
                </h2>
                <p>
                  {game.phase === "won"
                    ? "Ты обезвредил [ПИП] и лишил Искру спецэффектов. Зато обеспечил ей хороший финал."
                    : game.lossReason === "time"
                      ? "Даже дополнительная минута прошла — [ПИП] сработала. Искра уже придумывает заголовок."
                      : "Все попытки потрачены. Раунд за Искрой, а ты вошёл в историю этого эфира."}
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
        </div>

        {(game.phase === "dialogue" || game.phase === "encore") && ready && (
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
        {active && !finished && game.commentary.text && (
          <LiveCommentary commentary={game.commentary} />
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
