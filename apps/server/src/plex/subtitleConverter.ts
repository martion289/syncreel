function normalizeNewlines(input: string): string {
  return input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

function normalizeSrtTime(raw: string): string {
  // Accept H:MM:SS,mmm or HH:MM:SS,mmm or HH:MM:SS.mmm
  const cleaned = raw.trim().replace(',', '.');
  const match = cleaned.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!match) return cleaned;
  const hours = pad2(Number(match[1]));
  const mins = match[2];
  const secs = match[3];
  const ms = match[4].padEnd(3, '0').slice(0, 3);
  return `${hours}:${mins}:${secs}.${ms}`;
}

export function convertSrtToVtt(srt: string): string {
  const normalized = normalizeNewlines(srt).trim();
  if (!normalized) return 'WEBVTT\n\n';

  const blocks = normalized.split(/\n{2,}/);
  const cues: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    if (lines.length === 0) continue;

    // Optional cue index line
    let lineIdx = 0;
    if (/^\d+$/.test(lines[0].trim()) && lines.length > 1 && lines[1].includes('-->')) {
      lineIdx = 1;
    }

    const timingLine = lines[lineIdx];
    if (!timingLine || !timingLine.includes('-->')) continue;

    const arrowIdx = timingLine.indexOf('-->');
    const startRaw = timingLine.slice(0, arrowIdx).trim();
    const afterArrow = timingLine.slice(arrowIdx + 3).trim();
    const spaceIdx = afterArrow.search(/\s+/);
    const endRaw = spaceIdx >= 0 ? afterArrow.slice(0, spaceIdx) : afterArrow;
    const settings = spaceIdx >= 0 ? ` ${afterArrow.slice(spaceIdx).trim()}` : '';

    const textLines = lines.slice(lineIdx + 1).join('\n').trim();
    if (!textLines) continue;

    cues.push(`${normalizeSrtTime(startRaw)} --> ${normalizeSrtTime(endRaw)}${settings}\n${textLines}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function parseAssTimeToMs(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  const secs = Number(match[3]);
  // ASS uses centiseconds (2 digits)
  const frac = match[4].length <= 2 ? Number(match[4].padEnd(2, '0')) * 10 : Number(match[4].slice(0, 3));
  return hours * 3_600_000 + mins * 60_000 + secs * 1_000 + frac;
}

function formatMsAsVttTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const mins = Math.floor((clamped % 3_600_000) / 60_000);
  const secs = Math.floor((clamped % 60_000) / 1_000);
  const millis = clamped % 1_000;
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}.${pad3(millis)}`;
}

function splitAssFields(line: string, expectedColumns: number): string[] {
  const result: string[] = [];
  let cursor = 0;
  for (let i = 0; i < expectedColumns - 1; i++) {
    const commaIdx = line.indexOf(',', cursor);
    if (commaIdx < 0) break;
    result.push(line.slice(cursor, commaIdx).trim());
    cursor = commaIdx + 1;
  }
  result.push(line.slice(cursor).trim());
  return result;
}

function cleanAssDialogueText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .trim();
}

export function convertAssToVtt(ass: string): string {
  const lines = normalizeNewlines(ass).split('\n');
  let inEvents = false;
  let formatCols: string[] = [];
  let startCol = 1;
  let endCol = 2;
  let textCol = 9;

  const parsedCues: Array<{ startMs: number; endMs: number; text: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      inEvents = line.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) continue;

    if (line.toLowerCase().startsWith('format:')) {
      formatCols = line
        .slice('format:'.length)
        .split(',')
        .map((c) => c.trim().toLowerCase());
      const sIdx = formatCols.indexOf('start');
      const eIdx = formatCols.indexOf('end');
      const tIdx = formatCols.indexOf('text');
      if (sIdx >= 0) startCol = sIdx;
      if (eIdx >= 0) endCol = eIdx;
      if (tIdx >= 0) textCol = tIdx;
      continue;
    }

    if (line.toLowerCase().startsWith('dialogue:')) {
      const colCount = formatCols.length > 0 ? formatCols.length : 10;
      const fields = splitAssFields(line.slice('dialogue:'.length).trimStart(), colCount);
      const startMs = parseAssTimeToMs(fields[startCol] ?? '');
      const endMs = parseAssTimeToMs(fields[endCol] ?? '');
      const text = cleanAssDialogueText(fields[textCol] ?? '');
      if (startMs === null || endMs === null || endMs <= startMs || !text) continue;
      parsedCues.push({ startMs, endMs, text });
    }
  }

  parsedCues.sort((a, b) => a.startMs - b.startMs);

  const cues = parsedCues.map(
    (c) => `${formatMsAsVttTime(c.startMs)} --> ${formatMsAsVttTime(c.endMs)}\n${c.text}`
  );
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function convertToWebVtt(content: string, codec: string): string {
  const normalizedCodec = codec.toLowerCase();
  const trimmed = normalizeNewlines(content).trimStart();
  if (normalizedCodec === 'vtt' || normalizedCodec === 'webvtt' || trimmed.startsWith('WEBVTT')) {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  }
  if (normalizedCodec === 'ass' || normalizedCodec === 'ssa' || trimmed.includes('[Script Info]')) {
    return convertAssToVtt(content);
  }
  return convertSrtToVtt(content);
}
