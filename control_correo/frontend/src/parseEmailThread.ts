/**
 * Parsea body_text apilado (Gmail / Outlook ES-EN) en mensajes independientes.
 * Cada mensaje expone solo su contenido nuevo; las citas anidadas se eliminan
 * o se convierten en mensajes del hilo (estilo Gmail).
 */

export type ThreadMessage = {
  index: number;
  depth: number;
  sender: string | null;
  senderEmail: string | null;
  date: string | null;
  subject: string | null;
  headerLine: string | null;
  /** Texto útil del mensaje (sin citas posteriores). */
  body: string;
  /** Primera línea resumida para filas colapsadas. */
  preview: string;
};

export type ParsedThread = {
  /** Orden cronológico: índice 0 = más antiguo, último = más reciente. */
  messages: ThreadMessage[];
  isThread: boolean;
};

const GMAIL_ES =
  /(?:^|\n)\s*(El .+? escribió:)\s*/gi;
const GMAIL_EN =
  /(?:^|\n)\s*(On .+? wrote:)\s*/gi;
const SEP_ORIGINAL =
  /(?:^|\n)\s*(----- ?Original Message ?-----)\s*/gi;
const SEP_MENSAJE =
  /(?:^|\n)\s*(----- ?Mensaje original ?-----)\s*/gi;
const OUTLOOK_BLOCK =
  /(?:^|\n)\s*(De:\s*(?:[^\n<]*<[^>]+@[^>]+>|[^\s\n]+@[^\s\n]+)\s*\n\s*(?:Enviado(?: el)?|Sent):\s*[^\n]*)/gi;
const OUTLOOK_BLOCK_EN =
  /(?:^|\n)\s*(From:\s*(?:[^\n<]*<[^>]+@[^>]+>|[^\s\n]+@[^\s\n]+)\s*\n\s*(?:Sent|Date):\s*[^\n]*)/gi;
const RULE_LINE = /(?:^|\n)\s*_{5,}\s*(?:\n|$)/g;

const GMAIL_HEADER =
  /^(?:El .+?,\s*)?(.+?)\s*(?:<([^>]+@[^>]+)>|([^\s]+@[^\s]+))?\s*escribió:?$/i;
const GMAIL_HEADER_EN =
  /^(?:On .+?,\s*)?(.+?)\s*(?:<([^>]+@[^>]+)>|([^\s]+@[^>]+))?\s*wrote:?$/i;

const OUTLOOK_FROM = /^De:\s*(.+)$/im;
const OUTLOOK_FROM_EN = /^From:\s*(.+)$/im;
const OUTLOOK_SENT = /^(?:Enviado(?: el)?|Sent|Date):\s*(.+)$/im;
const OUTLOOK_SUBJECT = /^(?:Asunto|Subject):\s*(.+)$/im;

const NESTED_QUOTE_PATTERNS: RegExp[] = [
  /\n\s*El .+? escribió:\s*/i,
  /\n\s*On .+? wrote:\s*/i,
  /\n\s*----- ?Original Message ?-----\s*/i,
  /\n\s*----- ?Mensaje original ?-----\s*/i,
  /\n\s*De:\s*(?:[^\n<]*<[^>]+@[^>]+>|[^\s\n]+@[^\s\n]+)\s*\n\s*(?:Enviado(?: el)?|Sent):\s*/i,
  /\n\s*From:\s*(?:[^\n<]*<[^>]+@[^>]+>|[^\s\n]+@[^\s\n]+)\s*\n\s*(?:Sent|Date):\s*/i,
  /\n\s*_{5,}\s*\n/,
  /\n\s*\[(?:Mensaje recortado|Message clipped)[^\]]*\]/i,
];

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
  if (lineCount >= 6) return t;

  const insertBreaks: RegExp[] = [
    /\s+(El [^\n]{8,280}? escribió:)/gi,
    /\s+(On [^\n]{8,280}? wrote:)/gi,
    /\s+(----- ?Original Message ?-----)/gi,
    /\s+(----- ?Mensaje original ?-----)/gi,
    /\s+(De:\s+(?:[^\n<]*<[^>]+@[^>]+>|[^\s\n]+@[^\s\n]+)\s+Enviado(?: el)?:)/gi,
    /\s+(From:\s+(?:[^\n<]*<[^>]+@[^>]+>|[^\s\n]+@[^\s\n]+)\s+Sent:)/gi,
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
  if (angle) {
    return {
      name: angle[1].replace(/^["']|["']$/g, "").trim(),
      email: angle[2].trim(),
    };
  }
  const emailOnly = trimmed.match(/([^\s<>]+@[^\s<>]+)/);
  if (emailOnly) {
    return {
      name: trimmed.replace(emailOnly[0], "").replace(/^["'\s]+|["'\s]+$/g, "") || null,
      email: emailOnly[1],
    };
  }
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
  let headerEnd = 0;
  let inHeader = false;

  for (let i = 0; i < Math.min(lines.length, 14); i++) {
    const line = lines[i].trim();
    if (!line) {
      if (inHeader) headerEnd = i + 1;
      continue;
    }
    const de = line.match(OUTLOOK_FROM) || line.match(OUTLOOK_FROM_EN);
    if (de) {
      fromLine = de[1].trim();
      inHeader = true;
      headerEnd = i + 1;
      continue;
    }
    const sentM = line.match(OUTLOOK_SENT);
    if (sentM && inHeader) {
      sent = sentM[1].trim();
      headerEnd = i + 1;
      continue;
    }
    const subM = line.match(OUTLOOK_SUBJECT);
    if (subM && inHeader) {
      subject = subM[1].trim();
      headerEnd = i + 1;
      continue;
    }
    if (/^(?:Para|To|Cc|CC|Asunto|Subject):/i.test(line) && inHeader) {
      headerEnd = i + 1;
      continue;
    }
    if (inHeader) break;
  }

  if (!fromLine) return { meta: {}, body };

  const { name, email } = parseEmailFromHeaderLine(fromLine);
  const rest = lines.slice(headerEnd).join("\n").trim();
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

/** Elimina citas anidadas dentro de un mismo bloque (contenido ya extraído en otro mensaje). */
export function stripNestedQuotes(body: string): string {
  let cutAt = body.length;
  for (const re of NESTED_QUOTE_PATTERNS) {
    const m = body.match(re);
    if (m && m.index !== undefined && m.index > 0 && m.index < cutAt) {
      cutAt = m.index;
    }
  }
  let trimmed = body.slice(0, cutAt).trim();
  trimmed = trimmed.replace(/^>+\s?/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return trimmed;
}

function makePreview(body: string, maxLen = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return "(sin texto)";
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, maxLen - 1)}…`;
}

function cleanMessageBody(body: string): string {
  return stripNestedQuotes(body) || "(sin texto)";
}

type DelimiterHit = { index: number; raw: string };

function findDelimiterHits(text: string): DelimiterHit[] {
  const hits: DelimiterHit[] = [];
  const scanners: RegExp[] = [
    GMAIL_ES,
    GMAIL_EN,
    SEP_ORIGINAL,
    SEP_MENSAJE,
    OUTLOOK_BLOCK,
    OUTLOOK_BLOCK_EN,
    RULE_LINE,
  ];

  for (const re of scanners) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = (m[1] || m[0]).trim();
      const index = m.index + (m[0].length - raw.length);
      hits.push({ index, raw });
    }
  }

  hits.sort((a, b) => a.index - b.index);

  const deduped: DelimiterHit[] = [];
  for (const hit of hits) {
    const prev = deduped[deduped.length - 1];
    if (prev && hit.index <= prev.index + 8) continue;
    deduped.push(hit);
  }
  return deduped;
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

  const body = cleanMessageBody(block);

  return {
    index,
    depth: index,
    sender: meta.sender ?? null,
    senderEmail: meta.senderEmail ?? null,
    date: meta.date ?? null,
    subject: meta.subject ?? null,
    headerLine: meta.headerLine ?? headerLine,
    body,
    preview: makePreview(body),
  };
}

/**
 * Divide body_text en mensajes del hilo (orden cronológico: antiguo → reciente).
 */
export function parseEmailThread(
  bodyText: string | null | undefined,
  options?: { fromAddress?: string | null; subject?: string | null; emailDate?: string | null }
): ParsedThread {
  const raw = bodyText?.trim();
  if (!raw) {
    const body = "(sin cuerpo)";
    return {
      messages: [
        {
          index: 0,
          depth: 0,
          sender: options?.fromAddress
            ? parseEmailFromHeaderLine(options.fromAddress).name
            : null,
          senderEmail: options?.fromAddress
            ? parseEmailFromHeaderLine(options.fromAddress).email
            : null,
          date: options?.emailDate ?? null,
          subject: options?.subject ?? null,
          headerLine: null,
          body,
          preview: makePreview(body),
        },
      ],
      isThread: false,
    };
  }

  const expanded = expandCollapsedBody(raw);
  const hits = findDelimiterHits(expanded);

  if (hits.length === 0) {
    const single = parseBlock(expanded, 0, options?.fromAddress);
    if (options?.subject && !single.subject) single.subject = options.subject;
    if (options?.emailDate && !single.date) single.date = options.emailDate;
    return { messages: [single], isThread: false };
  }

  const newestFirst: ThreadMessage[] = [];
  let cursor = 0;

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const segment = expanded.slice(cursor, hit.index).trim();
    if (segment) {
      newestFirst.push(parseBlock(segment, newestFirst.length, newestFirst.length === 0 ? options?.fromAddress : null));
    }
    cursor = hit.index;
  }

  const tail = expanded.slice(cursor).trim();
  if (tail) {
    newestFirst.push(parseBlock(tail, newestFirst.length, null));
  }

  if (newestFirst.length === 0) {
    const single = parseBlock(expanded, 0, options?.fromAddress);
    return { messages: [single], isThread: false };
  }

  const latest = newestFirst[0];
  if (options?.subject && !latest.subject) latest.subject = options.subject;
  if (options?.emailDate && !latest.date) latest.date = options.emailDate;
  if (!latest.sender && options?.fromAddress) {
    const parsed = parseEmailFromHeaderLine(options.fromAddress);
    latest.sender = parsed.name;
    latest.senderEmail = parsed.email;
  }

  const chronological = [...newestFirst].reverse().map((msg, i) => ({
    ...msg,
    index: i,
    depth: i,
  }));

  return { messages: chronological, isThread: chronological.length > 1 };
}

export function senderLabel(msg: ThreadMessage): string {
  if (msg.sender && msg.senderEmail) return `${msg.sender} <${msg.senderEmail}>`;
  if (msg.sender) return msg.sender;
  if (msg.senderEmail) return msg.senderEmail;
  if (msg.headerLine) return msg.headerLine;
  return "Remitente desconocido";
}

export function senderInitial(msg: ThreadMessage): string {
  const src = (msg.sender || msg.senderEmail || "?").trim();
  const ch = src.charAt(0).toUpperCase();
  return /[A-Z0-9ÁÉÍÓÚÑ]/i.test(ch) ? ch : "?";
}
