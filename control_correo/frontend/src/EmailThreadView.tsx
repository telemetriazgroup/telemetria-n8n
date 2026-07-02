import { useMemo, useState, type ReactNode } from "react";
import {
  ParsedThread,
  ThreadMessage,
  parseEmailThread,
  senderLabel,
} from "./parseEmailThread";

type Props = {
  bodyText: string | null | undefined;
  snippet?: string | null;
  fromAddress?: string | null;
  subject?: string | null;
  matchTelemetriaExcerpt?: string | null;
  matchPersonExcerpt?: string | null;
};

function highlightExcerpt(body: string, excerpt: string | null | undefined): ReactNode {
  if (!excerpt || !body.includes(excerpt.trim())) {
    return body;
  }
  const needle = excerpt.trim();
  const idx = body.indexOf(needle);
  if (idx < 0) return body;
  return (
    <>
      {body.slice(0, idx)}
      <mark className="thread-highlight">{body.slice(idx, idx + needle.length)}</mark>
      {body.slice(idx + needle.length)}
    </>
  );
}

function MessageCard({
  msg,
  isLatest,
  defaultOpen,
  highlightExcerptText,
}: {
  msg: ThreadMessage;
  isLatest: boolean;
  defaultOpen: boolean;
  highlightExcerptText?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <article className={`thread-msg ${isLatest ? "thread-msg-latest" : "thread-msg-quoted"}`}>
      <button
        type="button"
        className="thread-msg-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="thread-msg-badge">{isLatest ? "Más reciente" : `#${msg.index + 1}`}</span>
        <span className="thread-msg-sender">{senderLabel(msg)}</span>
        {msg.date && <span className="thread-msg-date">{msg.date}</span>}
        <span className="thread-msg-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="thread-msg-body">
          {msg.subject && (
            <p className="thread-msg-subject">
              <strong>Asunto:</strong> {msg.subject}
            </p>
          )}
          {msg.headerLine && /escribió|wrote|Original|Mensaje original/i.test(msg.headerLine) && (
            <p className="thread-msg-meta muted">{msg.headerLine}</p>
          )}
          <pre className="thread-msg-text">
            {highlightExcerpt(msg.body, highlightExcerptText)}
          </pre>
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
  matchTelemetriaExcerpt,
  matchPersonExcerpt,
}: Props) {
  const parsed: ParsedThread = useMemo(
    () => parseEmailThread(bodyText || snippet, { fromAddress, subject }),
    [bodyText, snippet, fromAddress, subject]
  );

  const highlight =
    matchTelemetriaExcerpt?.trim() ||
    matchPersonExcerpt?.trim() ||
    null;

  if (!parsed.isThread) {
    const msg = parsed.messages[0];
    return (
      <div className="thread-single">
        <MessageCard
          msg={msg}
          isLatest
          defaultOpen
          highlightExcerptText={highlight}
        />
      </div>
    );
  }

  return (
    <div className="thread-flow">
      <p className="muted thread-flow-hint">
        Hilo reconstruido ({parsed.messages.length} mensajes) — el más reciente arriba.
      </p>
      {parsed.messages.map((msg, i) => (
        <MessageCard
          key={msg.index}
          msg={msg}
          isLatest={i === 0}
          defaultOpen={i === 0}
          highlightExcerptText={i === 0 ? highlight : null}
        />
      ))}
    </div>
  );
}
