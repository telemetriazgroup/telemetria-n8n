/**
 * Parsea body_text con mensajes apilados (Gmail / Outlook en español e inglés).
 * Pensado para hilos donde Normalizar dejó todo en una sola cadena o con saltos.
 */

export type ThreadMessage = {
  index: number;
  depth: number;
  sender: string | null;
  senderEmail: string | null;
  date: string | null;
  subject: string | null;
  headerLine: string | null;
  body: string;
};

export type ParsedThread = {
  messages: ThreadMessage[];
  isThread: boolean;
};

const THREAD_SPLIT =
  /(?=(?:^|\n)\s*(?:El .+? escribió:|On .+? wrote:|----- ?Original Message ?-----|----- ?Mensaje original ?-----|_{5,}))/gim;

const GMAIL_HEADER =
  /^(?:El .+?,\s*)?(.+?)\s*(?:<([^>]+@[^>]+)>|([^\s]+@[^\s]+))?\s*escribió:?$/i;
const GMAIL_HEADER_EN =
  /^(?:On .+?,\s*)?(.+?)\s*(?:<([^>]+@[^>]+)>|([^\s]+@[^>]+))?\s*wrote:?$/i;

const OUTLOOK_FROM = /^De:\s*(.+)$/im;
const OUTLOOK_FROM_EN = /^From:\s*(.+)$/im;
const OUTLOOK_SENT = /^(?:Enviado|Sent):\s*(.+)$/im;
const OUTLOOK_SUBJECT = /^(?:Asunto|Subject):\s*(.+)$/im;

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\[image:[^\]]*\]/gi, " ")
    .replace(/\[cid:[^\]]*\]/gi, " ")
    .trim();
}

/** Inserta saltos antes de marcadores cuando el cuerpo viene en una sola línea. */
export function expandCollapsedBody(text: string): string {
  let t = normalizeText(text);
  const lineCount = t.split("\n").length;
  if (lineCount >= 4) return t;

  const insertBreaks: RegExp[] = [
    /\s+(El [^\n]{8,240}? escribió:)/gi,
    /\s+(On [^\n]{8,240}? wrote:)/gi,
    /\s+(----- ?Original Message ?-----)/gi,
    /\s+(----- ?Mensaje original ?-----)/gi,
    /\s+(De:\s+[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi,
    /\s+(From:\s+[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi,
  ];

  for (const re of insertBreaks) {
    t = t.replace(re, "\n\n$1");
  }
  return t.replace(/\n{3,}/g, "\n\n");
}

function parseEmailFromHeaderLine(line: string): { name: string | null; email: string | null } {
  const trimmed = line.trim();
  const angle = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (angle) return { name: angle[1].replace(/^["']|["']$/g, "").trim(), email: angle[2].trim() };
  const emailOnly = trimmed.match(/([^\s<>]+@[^\s<>]+)/);
  if (emailOnly) return { name: trimmed.replace(emailOnly[0], "").replace(/^["'\s]+|["'\s]+$/g, "") || null, email: emailOnly[1] };
  return { name: trimmed || null, email: null };
}

function parseGmailDelimiter(headerLine: string): Partial<ThreadMessage> {
  const line = headerLine.replace(/\s+/g, " ").trim();
  let m = line.match(GMAIL_HEADER);
  if (!m) m = line.match(GMAIL_HEADER_EN);
  if (!m) return { headerLine: line, sender: null, senderEmail: null, date: null };

  const name = m[1]?.trim() || null;
  const email = (m[2] || m[3] || "").trim() || null;
  const dateMatch = line.match(/^El (.+?),/i) || line.match(/^On (.+?),/i);
  return {
    headerLine: line,
    sender: name,
    senderEmail: email,
    date: dateMatch ? dateMatch[1].trim() : null,
  };
}

function stripOutlookHeaderBlock(body: string): {
  meta: Partial<ThreadMessage>;
  body: string;
} {
  const lines = body.split("\n");
  let fromLine: string | null = null;
  let sent: string | null = null;
  let subject: string | null = null;
  let headerLines = 0;

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const line = lines[i].trim();
    if (!line) {
      if (headerLines > 0) {
        headerLines++;
        continue;
      }
      continue;
    }
    const de = line.match(OUTLOOK_FROM) || line.match(OUTLOOK_FROM_EN);
    if (de) {
      fromLine = de[1].trim();
      headerLines = i + 1;
      continue;
    }
    const sentM = line.match(OUTLOOK_SENT);
    if (sentM && headerLines > 0) {
      sent = sentM[1].trim();
      headerLines = i + 1;
      continue;
    }
    const subM = line.match(OUTLOOK_SUBJECT);
    if (subM && headerLines > 0) {
      subject = subM[1].trim();
      headerLines = i + 1;
      continue;
    }
    if (/^(?:Para|To|Cc|CC|Asunto|Subject):/i.test(line) && headerLines > 0) {
      headerLines = i + 1;
      continue;
    }
    if (headerLines > 0) break;
  }

  if (!fromLine) return { meta: {}, body };

  const { name, email } = parseEmailFromHeaderLine(fromLine);
  const rest = lines.slice(headerLines).join("\n").trim();
  return {
    meta: {
      sender: name,
      senderEmail: email,
      date: sent,
      subject,
      headerLine: fromLine,
    },
    body: rest || body,
  };
}

function cleanMessageBody(body: string): string {
  return body
    .replace(/^>+\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseBlock(
  rawBlock: string,
  index: number,
  fallbackFrom?: string | null
): ThreadMessage {
  let block = rawBlock.trim();
  let headerLine: string | null = null;
  let meta: Partial<ThreadMessage> = {};

  const delimiterMatch = block.match(
    /^(El .+? escribió:|On .+? wrote:|----- ?Original Message ?-----|----- ?Mensaje original ?-----)\s*/i
  );
  if (delimiterMatch) {
    headerLine = delimiterMatch[1].trim();
    block = block.slice(delimiterMatch[0].length).trim();
    if (/escribió|wrote/i.test(headerLine)) {
      meta = parseGmailDelimiter(headerLine);
    } else {
      meta = { headerLine };
    }
  }

  const outlook = stripOutlookHeaderBlock(block);
  if (outlook.meta.sender || outlook.meta.senderEmail) {
    meta = { ...meta, ...outlook.meta };
    block = outlook.body;
  }

  if (index === 0 && !meta.sender && fallbackFrom) {
    const parsed = parseEmailFromHeaderLine(fallbackFrom);
    meta.sender = parsed.name;
    meta.senderEmail = parsed.email;
  }

  return {
    index,
    depth: index,
    sender: meta.sender ?? null,
    senderEmail: meta.senderEmail ?? null,
    date: meta.date ?? null,
    subject: meta.subject ?? null,
    headerLine: meta.headerLine ?? headerLine,
    body: cleanMessageBody(block) || "(sin texto)",
  };
}

/**
 * Divide body_text en mensajes sucesivos del hilo (más reciente primero).
 */
export function parseEmailThread(
  bodyText: string | null | undefined,
  options?: { fromAddress?: string | null; subject?: string | null }
): ParsedThread {
  const raw = bodyText?.trim();
  if (!raw) {
    return {
      messages: [
        {
          index: 0,
          depth: 0,
          sender: options?.fromAddress ? parseEmailFromHeaderLine(options.fromAddress).name : null,
          senderEmail: options?.fromAddress
            ? parseEmailFromHeaderLine(options.fromAddress).email
            : null,
          date: null,
          subject: options?.subject ?? null,
          headerLine: null,
          body: "(sin cuerpo)",
        },
      ],
      isThread: false,
    };
  }

  const expanded = expandCollapsedBody(raw);
  const parts = expanded
    .split(THREAD_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    const single = parseBlock(expanded, 0, options?.fromAddress);
    if (options?.subject && !single.subject) single.subject = options.subject;
    return { messages: [single], isThread: false };
  }

  const messages = parts.map((part, i) => parseBlock(part, i, i === 0 ? options?.fromAddress : null));
  if (messages[0] && options?.subject && !messages[0].subject) {
    messages[0].subject = options.subject;
  }

  return { messages, isThread: messages.length > 1 };
}

export function senderLabel(msg: ThreadMessage): string {
  if (msg.sender && msg.senderEmail) return `${msg.sender} <${msg.senderEmail}>`;
  if (msg.sender) return msg.sender;
  if (msg.senderEmail) return msg.senderEmail;
  if (msg.headerLine) return msg.headerLine;
  return "Remitente desconocido";
}
