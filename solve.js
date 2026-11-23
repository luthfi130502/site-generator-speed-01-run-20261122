// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
//
// Same answers as the reference build, produced faster: templates are
// compiled to plain JS functions once per case, Markdown is rendered in a
// single pass with chunked inline parsing (no per-character string
// building), slugs are cached, and repeated link resolutions are memoised.
// Written from the reference's documented behaviour; no dependency.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const ESC_RE = /[&<>"']/;

function escapeHtml(text) {
  if (!ESC_RE.test(text)) return text;
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const SLUG_MAX = 64;
const slugCache = new Map();

function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  let plain = text;
  // NFKD + strip combining marks only matters when non-ASCII is present;
  // pure ASCII text is already in normal form.
  if (/[^\x00-\x7F]/.test(text)) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = plain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  slugCache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The words of a body: runs of characters other than whitespace (no regex, no allocation). */
function wordsOf(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 32) {
      inWord = false;
      continue;
    }
    if (c < 128 || (c !== 160 && c !== 0x202f && c !== 0x205f && c !== 0x3000 && c !== 0xfeff && (c < 0x2000 || c > 0x200a))) {
      if (!inWord) {
        inWord = true;
        count++;
      }
    } else inWord = false;
  }
  return count;
}

/** `rel` from the directory `dir` of a source, or null when it climbs out. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

const RESERVED = ['posts', 'tags', 'page'];

/** Days in month `m` of year `y`, Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A quoted string's value, or its refusal reason. */
function quotedValue(raw) {
  if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
  let out = '';
  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i];
    if (c === '\\') {
      const n = raw[i + 1];
      if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) {
        return { error: 'a quoted string holds an escape other than \\" or \\\\' };
      }
      out += n;
      i++;
    } else if (c === '"') {
      return { error: 'a quoted string holds a stray quote' };
    } else out += c;
  }
  return { value: out };
}

/** One key's value, or why it is refused. */
function keyValue(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      if (raw[0] === '"') {
        const s = quotedValue(raw);
        return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
      }
      if (raw[0] === '[') return { error: `key "${key}": a bare string opens on [` };
      return { value: raw };
    }
    case 'date': {
      let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-';
      if (ok) {
        for (let i = 0; i < 10 && ok; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) ok = false;
        }
      }
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',');
      for (let i = 0; i < tags.length; i++) {
        tags[i] = tags[i].trim();
        const t = tags[i];
        if (t === '' || t.includes('"') || t.includes('[') || t.includes(']')) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      let ok = raw.length > 0;
      for (let i = 0; i < raw.length && ok; i++) {
        const c = raw.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) ok = false;
      }
      return ok ? { value: raw } : { error: 'key "layout": not a template name' };
    }
    case 'slug': {
      let ok = raw.length > 0 && raw.length <= 64;
      let prevDash = true;
      for (let i = 0; i < raw.length && ok; i++) {
        const c = raw.charCodeAt(i);
        const alnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
        if (c === 45) {
          if (prevDash) ok = false;
          prevDash = true;
        } else if (alnum) {
          prevDash = false;
        } else ok = false;
      }
      if (prevDash) ok = false;
      return ok ? { value: raw } : { error: 'key "slug": not a slug' };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

/**
 * A source's front matter and body: { data, body }, or { error }.
 * `text` has "\n" line ends. Lines are walked with indexOf so the body is
 * never split into an array.
 */
function parseFrontMatter(text) {
  // First line must be exactly "---".
  let nl = text.indexOf('\n');
  const firstEnd = nl === -1 ? text.length : nl;
  if (text.slice(0, firstEnd) !== '---') return { error: 'no front matter' };
  // Find the closing "---" line.
  let pos = nl === -1 ? text.length : nl + 1;
  let closeStart = -1;
  let closeEnd = -1;
  while (pos <= text.length) {
    nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (end - pos === 3 && text[pos] === '-' && text[pos + 1] === '-' && text[pos + 2] === '-') {
      closeStart = pos;
      closeEnd = end;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let lineNo = 1; // lines counted from 1 at the opening ---
  pos = text.indexOf('\n', 0) + 1;
  while (pos < closeStart) {
    nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    lineNo++;
    const line = text.slice(pos, end);
    // Blank (spaces/tabs only) or comment: skip.
    let blank = true;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== ' ' && line[i] !== '\t') { blank = false; break; }
    }
    if (!blank && line[0] !== '#') {
      // "key: value": key of [a-z_]+, colon, one space, value.
      let i = 0;
      while (i < line.length) {
        const c = line.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || c === 95)) break;
        i++;
      }
      const key = line.slice(0, i);
      let raw = null;
      if (i > 0 && line[i] === ':') {
        if (i + 1 === line.length) raw = '';
        else if (line[i + 1] === ' ') raw = line.slice(i + 2);
        else raw = null;
      }
      if (raw === null) return { error: `line ${lineNo} is not "key: value"` };
      // Trailing spaces/tabs dropped from the value.
      let r = raw.length;
      while (r > 0 && (raw[r - 1] === ' ' || raw[r - 1] === '\t')) r--;
      raw = raw.slice(0, r);
      if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = keyValue(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd === text.length ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** First index from `from` where `s` holds `what` outside an escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** First single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/**
 * `s` rendered inline; `env.link(target)` is a link's href. Literal runs
 * are escaped in bulk, and the scan jumps from one special character to
 * the next with one regex pass instead of stepping character by character.
 */
function inline(s, env) {
  const parts = [];
  const n = s.length;
  let lit = 0;
  const re = /[\\`*[]/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const j = m.index;
    const c = m[0];
    if (c === '\\' && j + 1 < n && ESCAPABLE.has(s[j + 1])) {
      if (j > lit) parts.push(escapeHtml(s.slice(lit, j)));
      parts.push(escapeHtml(s[j + 1]));
      re.lastIndex = j + 2;
      lit = j + 2;
      continue;
    }
    if (c === '`') {
      const close = s.indexOf('`', j + 1);
      if (close > j + 1) {
        if (j > lit) parts.push(escapeHtml(s.slice(lit, j)));
        parts.push('<code>', escapeHtml(s.slice(j + 1, close)), '</code>');
        re.lastIndex = close + 1;
        lit = close + 1;
      } else re.lastIndex = j + 1;
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const m2 = findUnescaped(s, '**', j + 2);
        if (m2 > j + 2) {
          if (j > lit) parts.push(escapeHtml(s.slice(lit, j)));
          parts.push('<strong>', inline(s.slice(j + 2, m2), env), '</strong>');
          re.lastIndex = m2 + 2;
          lit = m2 + 2;
        } else re.lastIndex = j + 2;
        continue;
      }
      const m2 = findSingleStar(s, j + 1);
      if (m2 > j + 1) {
        if (j > lit) parts.push(escapeHtml(s.slice(lit, j)));
        parts.push('<em>', inline(s.slice(j + 1, m2), env), '</em>');
        re.lastIndex = m2 + 1;
        lit = m2 + 1;
      } else re.lastIndex = j + 1;
      continue;
    }
    // '['
    const k2 = findUnescaped(s, ']', j + 1);
    const m2 = k2 !== -1 && s[k2 + 1] === '(' ? s.indexOf(')', k2 + 2) : -1;
    const target = m2 === -1 ? '' : s.slice(k2 + 2, m2);
    if (target !== '' && !/\s/.test(target)) {
      if (j > lit) parts.push(escapeHtml(s.slice(lit, j)));
      parts.push('<a href="', escapeHtml(env.link(target)), '">', inline(s.slice(j + 1, k2), env), '</a>');
      re.lastIndex = m2 + 1;
      lit = m2 + 1;
      continue;
    }
    re.lastIndex = j + 1;
  }
  if (n > lit) parts.push(escapeHtml(s.slice(lit, n)));
  return parts.join('');
}

const isBlankLine = (line) => {
  for (let i = 0; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
};

const trimLine = (line) => {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
};

/** Fence-open info, or null: { lang }. */
function fenceOpen(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45;
    if (!ok) break;
    i++;
  }
  for (let j = i; j < line.length; j++) if (line[j] !== ' ' && line[j] !== '\t') return null;
  return { lang: line.slice(3, i) };
}

const isFenceClose = (line) => {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return false;
  for (let i = 3; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
};

/** Heading info, or null: { depth, text }. */
function headingOf(line) {
  let depth = 0;
  while (depth < line.length && line[depth] === '#') depth++;
  if (depth === 0 || depth > 6) return null;
  const c = line[depth];
  if (c !== ' ' && c !== '\t') return null;
  let end = line.length;
  while (end > depth && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
  if (end === depth + 1 && (line[depth] === ' ' || line[depth] === '\t')) return null;
  // Text is the remainder after the hashes and their following spaces,
  // with trailing spaces/tabs dropped; empty text is no heading.
  let start = depth;
  while (start < end && (line[start] === ' ' || line[start] === '\t')) start++;
  if (start >= end) return null;
  return { depth, text: line.slice(start, end) };
}

const isHr = (line) => {
  const c0 = line.charCodeAt(0);
  if (c0 !== 45 && c0 !== 42) return false;
  if (line[1] !== line[0] || line[2] !== line[0]) return false;
  for (let i = 3; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
};

/** Whether `line` ends a paragraph: blank, fence, heading or thematic break. */
function endsParagraph(line) {
  const c0 = line.charCodeAt(0);
  if (c0 !== c0 || c0 === 32 || c0 === 9) return isBlankLine(line);
  if (c0 === 96) return fenceOpen(line) !== null;
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return isHr(line);
  return false;
}

const isBullet = (line) => (line[0] === '-' || line[0] === '*') && line[1] === ' ';

/** Ordered-list marker info, or null: { num, rest }. */
function orderedOf(line) {
  let i = 0;
  while (i < line.length && i < 9 && line[i] >= '0' && line[i] <= '9') i++;
  if (i === 0 || i >= 9 && line[9] >= '0' && line[9] <= '9') return null;
  if (line[i] !== '.' || line[i + 1] !== ' ') return null;
  return { num: line.slice(0, i), rest: line.slice(i + 2) };
}

const isContinued = (line) => {
  let j = 0;
  while (line[j] === ' ') j++;
  if (j < 2) return false;
  const c = line[j];
  return c !== undefined && c !== ' ' && c !== '\t';
};

/**
 * `src` rendered: its HTML, table of contents and excerpt (first
 * paragraph's inline HTML, or ""). `env.link(target)` resolves links.
 */
function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const ids = new Set();
  const out = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const c0 = line.charCodeAt(0);
    // Dispatch on the first character: most lines are prose, which falls
    // through to the paragraph at the bottom without any helper call.
    if (c0 !== c0 || c0 === 32 || c0 === 9) {
      if (isBlankLine(line)) {
        i++;
        continue;
      }
    } else if (c0 === 96) {
      const fence = fenceOpen(line);
      if (fence !== null) {
        const body = [];
        i++;
        while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
        i++;
        const cls = fence.lang === '' ? '' : ` class="language-${escapeHtml(fence.lang)}"`;
        let code = `<pre><code${cls}>`;
        for (let k = 0; k < body.length; k++) code += `${escapeHtml(body[k])}\n`;
        out.push(`${code}</code></pre>\n`);
        continue;
      }
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const html = inline(heading.text, env);
        out.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>\n`);
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isHr(line)) {
        out.push('<hr>\n');
        i++;
        continue;
      }
      if (isBullet(line)) {
        const items = [];
        while (i < n) {
          const l = lines[i];
          const d0 = l.charCodeAt(0);
          if ((d0 === 45 || d0 === 42) && isBullet(l)) {
            items.push([trimLine(l.slice(2))]);
            i++;
            continue;
          }
          if (d0 === 32 && isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
            continue;
          }
          break;
        }
        let html = '<ul>\n';
        for (let k = 0; k < items.length; k++) html += `<li>${inline(items[k].join('\n'), env)}</li>\n`;
        out.push(`${html}</ul>\n`);
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < n && lines[i][0] === '>') body.push(lines[i++].replace(/^> ?/, ''));
      const kept = [];
      for (let k = 0; k < body.length; k++) {
        const t = trimLine(body[k]);
        if (t !== '') kept.push(t);
      }
      out.push(kept.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>\n`);
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const ordered = orderedOf(line);
      if (ordered !== null) {
        const items = [];
        while (i < n) {
          const l = lines[i];
          const d0 = l.charCodeAt(0);
          if (d0 >= 48 && d0 <= 57) {
            const m = orderedOf(l);
            if (m !== null) {
              items.push([trimLine(m.rest)]);
              i++;
              continue;
            }
          }
          if (d0 === 32 && isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
            continue;
          }
          break;
        }
        const open = Number(ordered.num) !== 1 ? `<ol start="${Number(ordered.num)}">` : '<ol>';
        let html = `${open}\n`;
        for (let k = 0; k < items.length; k++) html += `<li>${inline(items[k].join('\n'), env)}</li>\n`;
        out.push(`${html}</ol>\n`);
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    out.push(`<p>${html}</p>\n`);
  }
  return { html: out.join(''), toc, excerpt: excerpt ?? '' };
}

class TemplateError extends Error {}

const TPL_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const TPL_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const TPL_IF = /^if (not )?(\S+)$/;
const TPL_INCLUDE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!TPL_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}; a standalone tag's line goes with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = TPL_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = TPL_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = TPL_INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

const HAS = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * A template compiled to a fast function (env, H, _d) -> string. `env` is a
 * prototype-chained scope (a loop's variables shadow the outer ones, and
 * the top scope has a null prototype so Object.prototype never leaks in);
 * `H` carries the escape, text and truthiness helpers plus the map of
 * compiled templates; `_d` is the include depth. Loop scopes are one
 * object per loop execution, mutated per iteration: rendering is
 * synchronous and nothing retains a scope.
 */
function compileTemplate(name, src) {
  const nodes = parseTemplate(name, src);
  const code = ['let o="";const esc=H.esc,txt=H.txt,tru=H.truthy,has=H.has,tpl=H.tpl;'];
  let tmp = 0;
  // Emits statements that leave the value at `path` in a fresh temp and
  // opens a block around it; the caller closes the block.
  const lookup = (path) => {
    const t = `_v${tmp++}`;
    code.push(`{let ${t}=env[${JSON.stringify(path[0])}];`);
    for (let k = 1; k < path.length; k++) {
      code.push(`${t}=(${t}!==null&&typeof ${t}==="object"&&has(${t},${JSON.stringify(path[k])}))?${t}[${JSON.stringify(path[k])}]:undefined;`);
    }
    return t;
  };
  const gen = (ns) => {
    for (const nd of ns) genNode(nd);
  };
  const genNode = (nd) => {
    switch (nd.kind) {
      case 'text':
        code.push(`o+=${JSON.stringify(nd.text)};`);
        break;
      case 'var': {
        const t = lookup(nd.path);
        code.push(`o+=esc(typeof ${t}==="string"?${t}:txt(${t}));}`);
        break;
      }
      case 'raw': {
        const t = lookup(nd.path);
        code.push(`o+=typeof ${t}==="string"?${t}:txt(${t});}`);
        break;
      }
      case 'if': {
        const t = lookup(nd.path);
        code.push(`if(tru(${t})!==${nd.not}){`);
        gen(nd.then);
        code.push('}');
        if (nd.else !== null) {
          code.push('else{');
          gen(nd.else);
          code.push('}');
        }
        code.push('}');
        break;
      }
      case 'for': {
        const t = lookup(nd.path);
        code.push(`if(Array.isArray(${t})){const _p=env;const _e=Object.create(_p);const _l={index:0,first:false,last:false,length:${t}.length};for(let _k=0;_k<${t}.length;_k++){_l.index=_k+1;_l.first=_k===0;_l.last=_k===${t}.length-1;_e[${JSON.stringify(nd.name)}]=${t}[_k];_e.loop=_l;env=_e;`);
        gen(nd.body);
        code.push(`}env=_p;}}`);
        break;
      }
      case 'include':
        code.push(`{const _t=tpl.get(${JSON.stringify(nd.name)});if(_t!==undefined&&_d<8)o+=_t(env,H,_d+1);}`);
        break;
    }
  };
  gen(nodes);
  code.push('return o;');
  return new Function('env', 'H', '_d', code.join(''));
}

/** A link target with a scheme (`https:`, `mailto:` ...). */
function hasScheme(t) {
  const c0 = t.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

/** One site's output tree: path -> text. */
export function run(input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const H = { esc: escapeHtml, txt: textOf, truthy, has: HAS, tpl: templates };
  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. The sources, in code-unit order of their paths, line ends made "\n".
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // 2. Front matter: a refused source is reported and dropped, and so is a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // 3. Permalinks: each page's slug made unique in its directory, in source order.
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    s.slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.outDir = dir === '' ? s.slug : `${dir}/${s.slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Markdown, each body's links resolved to the pages and static files they name.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  const linkCache = new Map();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (hasScheme(target) || target[0] === '/' || target[0] === '#') return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const key = `${dir}\n${rel}`;
        let r = linkCache.get(key);
        if (r === undefined) {
          const path = rel === '' ? null : resolvePath(dir, rel);
          if (path !== null && bySource.has(path)) r = bySource.get(path).url;
          else if (path !== null && staticPaths.has(path)) r = `${base}/${path}`;
          else r = null;
          linkCache.set(key, r);
        }
        if (r === null) {
          broken.add(`broken-link ${s.path} -> ${target}`);
          return target;
        }
        return `${r}${frag}`;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.reading = Math.max(1, Math.ceil(wordsOf(s.body) / 200));
  }

  // 5. Collections: the posts, newest first and then by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. Tags, grouped by their slug, ordered by count and then slug.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Layouts: every page through its layout, the index and tag pages through theirs.
  const linkOf = (s) =>
    s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) };
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: s.reading,
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const pageOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: s.reading,
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });
  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const tagOf = (t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) });
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const output = {};
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    const env = Object.assign(Object.create(null), { site, tags: allTags, recent }, vars);
    return fn(env, H, 0);
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: tagOf(t) });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report: every refusal, draft, broken link and template that did
  // not parse, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
