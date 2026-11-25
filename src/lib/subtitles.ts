export interface Cue {
  start: number
  end: number
  text: string
}

function parseTimestamp(str?: string): number {
  if (!str) return -1
  const clean = str.replace(',', '.').trim().split(/\s+/)[0]
  const parts = clean.split(':')
  if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
  if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1])
  return -1
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

/** SRT + WebVTT + ASS parser. */
export function parseSubtitleText(content: string): Cue[] {
  if (!content) return []
  const cleaned = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const cues: Cue[] = []

  // Check if content is ASS / SSA format
  if (cleaned.includes('Dialogue:')) {
    const lines = cleaned.split('\n')
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('Dialogue:')) continue
      const rest = line.slice(9).trim()
      const parts = rest.split(',')
      if (parts.length < 10) continue
      const start = parseTimestamp(parts[1])
      const end = parseTimestamp(parts[2])
      if (start < 0 || end <= start || isNaN(start) || isNaN(end)) continue
      const text = decodeEntities(
        parts
          .slice(9)
          .join(',')
          .replace(/\{[^\}]*\}/g, '')
          .replace(/\\N/gi, '\n')
          .replace(/\\n/gi, '\n')
          .replace(/\\h/gi, ' ')
          .trim()
      )
      if (text) cues.push({ start, end, text })
    }
    if (cues.length) return cues
  }

  const lines = cleaned.split('\n')
  let i = 0
  while (i < lines.length) {
    const l = lines[i].trim()
    if (!l.includes('-->')) {
      i++
      continue
    }
    const [a, b] = l.split('-->')
    const start = parseTimestamp(a)
    const end = parseTimestamp(b)
    i++
    const textLines: string[] = []
    while (i < lines.length) {
      const cur = lines[i].trim()
      if (!cur) {
        i++
        break
      }
      // If next line is a cue number followed by a timestamp line, stop this cue
      if (/^\d+$/.test(cur) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
        break
      }
      if (cur.includes('-->')) {
        break
      }
      textLines.push(cur)
      i++
    }
    if (start >= 0 && end > start && !isNaN(start) && !isNaN(end)) {
      const text = decodeEntities(
        textLines
          .join('\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\{\\[^}]*\}/g, '')
          .trim()
      )
      if (text) cues.push({ start, end, text })
    }
  }
  return cues
}

export function findActiveCue(cues: Cue[], time: number, offset = 0): string | null {
  const t = time + offset
  const matches: string[] = []
  for (const c of cues) {
    if (t >= c.start && t <= c.end) {
      if (!matches.includes(c.text)) matches.push(c.text)
    }
  }
  return matches.length > 0 ? matches.join('\n') : null
}
