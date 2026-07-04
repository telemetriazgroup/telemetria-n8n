import { useMemo, useState } from "react";
import {
  ParsedThread,
  ThreadMessage,
  parseEmailThread,
  senderInitial,
  senderLabel,
} from "./parseEmailThread";
import {
  MatchHighlightInput,
  renderTextWithMatchHighlights,
  textContainsMatch,
} from "./matchHighlight";

type Props = MatchHighlightInput & {
  bodyText: string | null | undefined;
  snippet?: string | null;
  fromAddress?: string | null;
  subject?: string | null;
  emailDate?: string | null;
};

function MessageCard({
  msg,
  isLatest,
  hasMatch,
  defaultOpen,
  matchInput,
}: {
  msg: ThreadMessage;
  isLatest: boolean;
  hasMatch: boolean;
  defaultOpen: boolean;
  matchInput: MatchHighlightInput;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <article
      className={`thread-msg ${isLatest ? "thread-msg-latest" : "thread-msg-quoted"} ${
        hasMatch ? "thread-msg-has-match" : ""
      } ${open ? "thread-msg-open" : "thread-msg-collapsed"}`}
    >
      <button
        type="button"
        className="thread-msg-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="thread-msg-avatar" aria-hidden="true">
          {senderInitial(msg)}
        </span>
        <span className="thread-msg-head-main">
          <span className="thread-msg-head-row">
            <span className="thread-msg-sender">{senderLabel(msg)}</span>
            {hasMatch && <span className="thread-msg-match-tag">Coincidencia</span>}
            {msg.date && <span className="thread-msg-date">{msg.date}</span>}
          </span>
          {!open && (
            <span className="thread-msg-preview muted">
              {renderTextWithMatchHighlights(msg.preview, matchInput)}
            </span>
          )}
        </span>
        <span className="thread-msg-toggle" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="thread-msg-body">
          {isLatest && (
            <span className="thread-msg-badge thread-msg-badge-inline">Más reciente</span>
          )}
          {hasMatch && !isLatest && (
            <span className="thread-msg-badge thread-msg-badge-inline thread-msg-badge-match">
              Motivo del match aquí
            </span>
          )}
          {msg.subject && (
            <p className="thread-msg-subject">
              <strong>Asunto:</strong>{" "}
              {renderTextWithMatchHighlights(msg.subject, matchInput)}
            </p>
          )}
          <div className="thread-msg-text">
            {renderTextWithMatchHighlights(msg.body, matchInput)}
          </div>
        </div>
      )}
    </article>
  );
}

export default function EmailThreadView({
  bodyText,
  snippet,
  fromAddress,
  subject,
  emailDate,
  telemetriaKeyword,
  personKeyword,
  telemetriaExcerpt,
  personExcerpt,
}: Props) {
  const matchInput: MatchHighlightInput = {
    telemetriaKeyword,
    personKeyword,
    telemetriaExcerpt,
    personExcerpt,
  };

  const parsed: ParsedThread = useMemo(
    () =>
      parseEmailThread(bodyText || snippet, {
        fromAddress,
        subject,
        emailDate,
      }),
    [bodyText, snippet, fromAddress, subject, emailDate]
  );

  const matchMessageIndex = useMemo(() => {
    for (let i = parsed.messages.length - 1; i >= 0; i--) {
      if (textContainsMatch(parsed.messages[i].body, matchInput)) return i;
    }
    if (subject && textContainsMatch(subject, matchInput)) return parsed.messages.length - 1;
    return -1;
  }, [parsed.messages, matchInput, subject]);

  const lastIndex = parsed.messages.length - 1;

  if (!parsed.isThread) {
    const msg = parsed.messages[0];
    return (
      <div className="thread-gmail thread-single">
        <MessageCard
          msg={msg}
          isLatest
          hasMatch={textContainsMatch(msg.body, matchInput) || textContainsMatch(subject ?? "", matchInput)}
          defaultOpen
          matchInput={matchInput}
        />
      </div>
    );
  }

  return (
    <div className="thread-gmail thread-flow">
      <p className="muted thread-flow-hint">
        {parsed.messages.length} mensajes — orden cronológico (como Gmail). Líneas sombreadas =
        palabras que hicieron match (telemetría en ámbar, persona en azul).
      </p>
      {parsed.messages.map((msg, i) => (
        <MessageCard
          key={`${msg.index}-${msg.senderEmail ?? msg.sender ?? i}`}
          msg={msg}
          isLatest={i === lastIndex}
          hasMatch={i === matchMessageIndex}
          defaultOpen={i === lastIndex || i === matchMessageIndex}
          matchInput={matchInput}
        />
      ))}
    </div>
  );
}
