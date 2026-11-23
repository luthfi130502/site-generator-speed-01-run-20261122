// A fast drop-in for makefun-site 1.0.0, written from its README alone.
// run(input) returns the output tree makefun-site's build returns for one
// site: every path it writes and that file's text, byte for byte.
// No dependencies, no I/O, no clock, no randomness: the answer depends on
// the input alone, and two runs over the same input are identical.

// ------------------------------------------------------------------ helpers

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
/** HTML escaping: & < > " ' and nothing else. */
function escHtml(s) {
  return s.replace(ESC_RE, (c) => ESC_MAP[c]);
}

/** Trim spaces and tabs at the end of a line. */
function trimEndST(s) {
  let e = s.length;
  while (e > 0 && (s.charCodeAt(e - 1) === 32 || s.charCodeAt(e - 1) === 9)) e--;
  return e === s.length ? s : s.slice(0, e);
}

/** Trim spaces and tabs at both ends of a line. */
function trimST(s) {
  let b = 0;
  let e = s.length;
  while (b < e && (s.charCodeAt(b) === 32 || s.charCodeAt(b) === 9)) b++;
  while (e > b && (s.charCodeAt(e - 1) === 32 || s.charCodeAt(e - 1) === 9)) e--;
  return b === 0 && e === s.length ? s : s.slice(b, e);
}

/** A line is blank when it holds only spaces and tabs. */
function isBlank(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

const MARK_RE = /\p{M}/gu;
/**
 * makefun-site's slug: NFKD, combining marks dropped, A-Z lowered, each run
 * of characters other than a-z and 0-9 one '-', none at either end, cut to 64
 * characters with a '-' left at the cut dropped, 'untitled' when empty.
 */
function slugify(text, cache) {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const n = text.normalize('NFKD').replace(MARK_RE, '');
  let out = '';
  let lastDash = true;
  for (let i = 0; i < n.length; i++) {
    let c = n.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      out += String.fromCharCode(c);
      lastDash = false;
    } else if (!lastDash) {
      out += '-';
      lastDash = true;
    }
  }
  if (lastDash && out.length > 0) out = out.slice(0, -1);
  out = out.slice(0, 64);
  if (out.charCodeAt(out.length - 1) === 45) out = out.slice(0, -1);
  if (out === '') out = 'untitled';
  cache.set(text, out);
  return out;
}

/** `2026-11-09` is `9 November 2026`, from the string alone. */
function dateLong(d) {
  const y = d.slice(0, 4);
  const m = +d.slice(5, 7);
  const day = +d.slice(8, 10);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isLeap(y) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

/** A unique slug in one directory: s, s-2, s-3 and so on. */
function uniqueSlug(base, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  for (;;) {
    const s = `${base}-${n}`;
    if (!taken.has(s)) {
      taken.add(s);
      return s;
    }
    n++;
  }
}

// ------------------------------------------------------------- front matter

const FM_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LAYOUT_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_RE = /^([a-z_]+):(.*)$/;

const NOT_A_DATE = 'not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';

/** Parse a title/summary value: quoted ("..." with only \" and \\ escapes) or bare. */
function parseString(key, value) {
  if (value.charCodeAt(0) === 34) {
    // Quoted: scan for the closing quote.
    let out = '';
    for (let i = 1; i < value.length; i++) {
      const c = value[i];
      if (c === '\\') {
        const d = value[i + 1];
        if (d === '"' || d === '\\') {
          out += d;
          i++;
        } else {
          return { ok: false, reason: `key "${key}": a quoted string has a bad escape` };
        }
      } else if (c === '"') {
        if (i !== value.length - 1) {
          return { ok: false, reason: `key "${key}": a quoted string is not closed` };
        }
        return { ok: true, value: out };
      } else {
        out += c;
      }
    }
    return { ok: false, reason: `key "${key}": a quoted string is not closed` };
  }
  if (value.charCodeAt(0) === 91) {
    return { ok: false, reason: `key "${key}": a bare string opens on [` };
  }
  return { ok: true, value };
}

function validateDate(value) {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1) return false;
  const dim = DAYS_IN_MONTH[mo - 1] + (mo === 2 && isLeap(y) ? 1 : 0);
  return d <= dim;
}

function validateTags(value) {
  if (value.length < 2 || value.charCodeAt(0) !== 91 || value.charCodeAt(value.length - 1) !== 93) {
    return { ok: false, reason: 'key "tags": not a list [a, b]' };
  }
  const inner = value.slice(1, -1);
  if (inner === '') return { ok: true, value: [] };
  const parts = inner.split(',');
  const tags = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const t = trimST(parts[i]);
    if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
      return { ok: false, reason: 'key "tags": an empty tag, or one holding " [ or ]' };
    }
    tags[i] = t;
  }
  return { ok: true, value: tags };
}

/**
 * Parse one source's front matter. Returns { ok, fm, bodyStart } on success
 * or { ok:false, reason } when the source is refused. `lines` are the source's
 * lines after CR normalisation; bodyStart is the index of the first body line.
 */
function parseFrontMatter(lines) {
  if (lines.length === 0 || lines[0] !== '---') {
    return { ok: false, reason: 'no front matter' };
  }
  const fm = Object.create(null);
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') break;
    if (isBlank(line)) continue;
    if (line.charCodeAt(0) === 35) continue; // a comment opens on '#'
    const n = i + 1; // lines counted from 1 at the opening '---'
    const m = KEY_RE.exec(line);
    if (!m) return { ok: false, reason: `line ${n} is not "key: value"` };
    const key = m[1];
    let value = m[2];
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    value = trimEndST(value);
    if (!FM_KEYS.has(key)) return { ok: false, reason: `unknown key "${key}"` };
    if (Object.hasOwn(fm, key)) return { ok: false, reason: `key "${key}" is given twice` };
    if (value === '') return { ok: false, reason: `key "${key}" has no value` };
    if (key === 'title' || key === 'summary') {
      const r = parseString(key, value);
      if (!r.ok) return { ok: false, reason: r.reason };
      fm[key] = r.value;
    } else if (key === 'date') {
      if (!validateDate(value)) return { ok: false, reason: `key "date": ${NOT_A_DATE}` };
      fm[key] = value;
    } else if (key === 'tags') {
      const r = validateTags(value);
      if (!r.ok) return { ok: false, reason: r.reason };
      fm[key] = r.value;
    } else if (key === 'draft') {
      if (value !== 'true' && value !== 'false') {
        return { ok: false, reason: 'key "draft": true or false' };
      }
      fm[key] = value === 'true';
    } else if (key === 'layout') {
      if (!LAYOUT_RE.test(value)) return { ok: false, reason: 'key "layout": not a template name' };
      fm[key] = value;
    } else {
      // slug
      if (!SLUG_RE.test(value) || value.length > 64) {
        return { ok: false, reason: 'key "slug": not a slug' };
      }
      fm[key] = value;
    }
  }
  if (i >= lines.length) return { ok: false, reason: 'the front matter is not closed' };
  if (fm.title === undefined || fm.title === '') return { ok: false, reason: 'no title' };
  return { ok: true, fm, bodyStart: i + 1 };
}

// ----------------------------------------------------------------- markdown

// Characters an escape backslash may precede: \ ` * _ [ ] ( ) # + - . ! >
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const WS_RE = /\s/;
const SPECIAL_RE = /[\\`*\[&<>"']/g;

function findStrongClose(s, from) {
  const n = s.length;
  for (let k = from; k + 1 < n; k++) {
    const c = s[k];
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === '*' && s[k + 1] === '*') {
      // The first '**' after the opener is the closer, with at least one
      // character between; when it sits exactly at `from` its content is
      // empty, so no closer exists at all (a later one would hold it).
      if (k === from) return -1;
      return k;
    }
  }
  return -1;
}

function findEmClose(s, from) {
  const n = s.length;
  for (let k = from; k < n; k++) {
    const c = s[k];
    if (c === '\\') {
      k++; // skip the escaped character
      continue;
    }
    if (c === '*') {
      // A single '*' is one not beside another '*': a '**' pair is skipped
      // as a pair, so the '*' left over after a run of stars is single.
      if (s[k + 1] === '*') {
        k++;
        continue;
      }
      return k;
    }
  }
  return -1;
}

/**
 * Inline rendering, left to right, appending HTML to `out`. `ctx` resolves
 * link targets and records broken links. Nested strong, emphasis and link
 * text are parsed as inline in turn.
 */
function inlineInto(s, ctx, out) {
  const re = SPECIAL_RE;
  const n = s.length;
  let i = 0;
  while (i < n) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) {
      out.push(s.slice(i));
      break;
    }
    const j = m.index;
    if (j > i) out.push(s.slice(i, j));
    const c = m[0];
    if (c === '&') {
      out.push('&amp;');
      i = j + 1;
    } else if (c === '<') {
      out.push('&lt;');
      i = j + 1;
    } else if (c === '>') {
      out.push('&gt;');
      i = j + 1;
    } else if (c === '"') {
      out.push('&quot;');
      i = j + 1;
    } else if (c === "'") {
      out.push('&#39;');
      i = j + 1;
    } else if (c === '\\') {
      const d = s[j + 1];
      if (d !== undefined && ESCAPABLE.has(d)) {
        out.push(ESC_MAP[d] || d);
        i = j + 2;
      } else {
        out.push('\\');
        i = j + 1;
      }
    } else if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k === -1 || k === j + 1) {
        out.push('`');
        i = j + 1;
      } else {
        out.push('<code>', escHtml(s.slice(j + 1, k)), '</code>');
        i = k + 1;
      }
    } else if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findStrongClose(s, j + 2);
        if (k !== -1) {
          out.push('<strong>');
          inlineInto(s.slice(j + 2, k), ctx, out);
          out.push('</strong>');
          i = k + 2;
        } else {
          out.push('**');
          i = j + 2;
        }
      } else {
        const k = findEmClose(s, j + 1);
        if (k !== -1) {
          out.push('<em>');
          inlineInto(s.slice(j + 1, k), ctx, out);
          out.push('</em>');
          i = k + 1;
        } else {
          out.push('*');
          i = j + 1;
        }
      }
    } else {
      // '[': a link, [text](target), else '[' itself.
      let k = j + 1;
      let closeText = -1;
      while (k < n) {
        const ch = s[k];
        if (ch === '\\') {
          k += 2;
          continue;
        }
        if (ch === ']') {
          closeText = k;
          break;
        }
        k++;
      }
      if (closeText === -1 || s[closeText + 1] !== '(') {
        out.push('[');
        i = j + 1;
        continue;
      }
      const closeParen = s.indexOf(')', closeText + 2);
      if (closeParen === -1) {
        out.push('[');
        i = j + 1;
        continue;
      }
      const target = s.slice(closeText + 2, closeParen);
      if (target.length === 0 || WS_RE.test(target)) {
        out.push('[');
        i = j + 1;
        continue;
      }
      out.push('<a href="', escHtml(ctx.resolveLink(target)), '">');
      inlineInto(s.slice(j + 1, closeText), ctx, out);
      out.push('</a>');
      i = closeParen + 1;
    }
  }
}

/** Inline rendering of one string, as a single HTML string. */
function inlineHtml(s, ctx) {
  const out = [];
  inlineInto(s, ctx, out);
  return out.join('');
}

/** Count the body's words: runs of characters other than whitespace. */
function countWords(lines, start) {
  // Words of the body (lines joined by '\n'); a word never spans a line,
  // so counting per line with a fresh word state is the same count.
  let words = 0;
  for (let li = start; li < lines.length; li++) {
    const s = lines[li];
    let inWord = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const ws = c === 32 || c === 9 || c === 13 || c === 12 || c === 11;
      if (ws) inWord = false;
      else if (!inWord) {
        inWord = true;
        words++;
      }
    }
  }
  return words;
}

function matchFence(line) {
  if (!line.startsWith('```')) return null;
  const rest = line.slice(3);
  let i = 0;
  while (i < rest.length) {
    const c = rest.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = rest.slice(0, i);
  for (; i < rest.length; i++) {
    const c = rest.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
  }
  return lang;
}

function isClosingFence(line) {
  if (!line.startsWith('```')) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function matchHeading(line) {
  let h = 0;
  while (h < line.length && line.charCodeAt(h) === 35) h++;
  if (h < 1 || h > 6) return null;
  if (line.charCodeAt(h) !== 32 && line.charCodeAt(h) !== 9) return null;
  let t = h;
  while (line.charCodeAt(t) === 32 || line.charCodeAt(t) === 9) t++;
  const text = trimEndST(line.slice(t));
  if (text === '') return null;
  return { level: h, text };
}

function isHr(line) {
  const t = trimEndST(line);
  return t === '---' || t === '***';
}

function listStart(line) {
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return { kind: 'ul', marker: 2, start: 0 };
  if (c0 >= 48 && c0 <= 57) {
    let d = 0;
    while (d < line.length && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) d++;
    if (d > 0 && line.charCodeAt(d) === 46 && line.charCodeAt(d + 1) === 32) {
      return { kind: 'ol', marker: d + 2, start: +line.slice(0, d) };
    }
  }
  return null;
}

function isContinuation(line) {
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  for (let i = 2; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return true;
  }
  return false;
}

/**
 * Render one source's body. `lines` are the source's lines, `start` the index
 * of the first body line. Returns the body's HTML, its table of contents
 * (level 2 and 3 headings) and the first paragraph's inline HTML (or '').
 */
function renderBody(lines, start, ctx, slugCache) {
  const out = [];
  const toc = [];
  const headingTaken = new Set();
  let excerpt = '';
  let haveExcerpt = false;
  const n = lines.length;
  let i = start;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const lang = matchFence(line);
    if (lang !== null) {
      i++;
      out.push('<pre><code' + (lang === '' ? '>' : ` class="language-${lang}">`));
      while (i < n && !isClosingFence(lines[i])) {
        out.push(escHtml(lines[i]), '\n');
        i++;
      }
      if (i < n) i++; // the closing fence
      out.push('</code></pre>\n');
      continue;
    }
    const head = matchHeading(line);
    if (head !== null) {
      const id = uniqueSlug(slugify(head.text, slugCache), headingTaken);
      const html = inlineHtml(head.text, ctx);
      if (head.level === 2 || head.level === 3) toc.push({ level: head.level, id, html });
      out.push(`<h${head.level} id="${id}">`, html, `</h${head.level}>\n`);
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push('<hr>\n');
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      // Blockquote: lines opening on '>', the '>' and one space dropped, trimmed.
      const parts = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i].slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        l = trimST(l);
        if (l !== '') parts.push(l);
        i++;
      }
      out.push('<blockquote>\n');
      if (parts.length > 0) {
        out.push('<p>', inlineHtml(parts.join('\n'), ctx), '</p>\n');
      }
      out.push('</blockquote>\n');
      continue;
    }
    const ls = listStart(line);
    if (ls !== null) {
      const items = [];
      const kind = ls.kind;
      let firstStart = ls.start;
      while (i < n) {
        const l = lines[i];
        const s2 = listStart(l);
        if (s2 !== null && s2.kind === kind) {
          items.push(trimEndST(l.slice(s2.marker)));
          i++;
        } else if (isContinuation(l)) {
          items[items.length - 1] += '\n' + trimST(l);
          i++;
        } else break;
      }
      if (kind === 'ul') out.push('<ul>\n');
      else if (firstStart === 1) out.push('<ol>\n');
      else out.push(`<ol start="${firstStart}">\n`);
      for (const it of items) out.push('<li>', inlineHtml(it, ctx), '</li>\n');
      out.push(kind === 'ul' ? '</ul>\n' : '</ol>\n');
      continue;
    }
    // A paragraph: lines up to a blank line, a fence, a heading or a break.
    const parts = [];
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) break;
      if (matchFence(l) !== null) break;
      if (matchHeading(l) !== null) break;
      if (isHr(l)) break;
      parts.push(trimST(l));
      i++;
    }
    const html = inlineHtml(parts.join('\n'), ctx);
    if (!haveExcerpt) {
      excerpt = html;
      haveExcerpt = true;
    }
    out.push('<p>', html, '</p>\n');
  }
  return { html: out.join(''), toc, excerpt };
}

// ---------------------------------------------------------------- templates

// Node types: 0 text, 1 variable, 2 include, 3 for, 4 if.
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validPath(s) {
  const parts = s.split('.');
  if (parts.length === 0) return null;
  for (const p of parts) if (!NAME_RE.test(p)) return null;
  return parts;
}

function parseTagContent(content) {
  if (content === 'endfor') return { kind: 'endfor' };
  if (content === 'endif') return { kind: 'endif' };
  if (content === 'else') return { kind: 'else' };
  let m = /^include\s+"([^"]*)"$/.exec(content);
  if (m) return { kind: 'include', name: m[1] };
  m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/.exec(content);
  if (m) {
    const path = validPath(m[2].trim());
    if (!path) return { kind: 'bad', reason: `"${content}" is not a tag` };
    return { kind: 'for', var: m[1], path };
  }
  m = /^if\s+(not\s+)?(.+)$/.exec(content);
  if (m) {
    const path = validPath(m[2].trim());
    if (!path) return { kind: 'bad', reason: `"${content}" is not a tag` };
    return { kind: 'if', neg: !!m[1], path };
  }
  return { kind: 'bad', reason: `"${content}" is not a tag` };
}

/**
 * Parse a template into a node tree. A {% %} tag alone on its line (only
 * spaces or tabs beside it) takes the whole line with it, its newline
 * included; {{ }} and {{{ }}} never do.
 */
function parseTemplate(src) {
  const tokens = [];
  const n = src.length;
  let pos = 0;
  while (pos < n) {
    const i1 = src.indexOf('{{', pos);
    const i2 = src.indexOf('{%', pos);
    let j;
    let isTag;
    if (i1 === -1 && i2 === -1) {
      tokens.push({ t: 0, s: src.slice(pos) });
      pos = n;
      break;
    }
    if (i2 === -1 || (i1 !== -1 && i1 < i2)) {
      j = i1;
      isTag = false;
    } else {
      j = i2;
      isTag = true;
    }
    if (!isTag) {
      // {{ path }} or {{{ path }}}
      const raw = src.charCodeAt(j + 2) === 123;
      const close = raw ? '}}}' : '}}';
      const k = src.indexOf(close, j + (raw ? 3 : 2));
      if (k === -1) return { ok: false, reason: raw ? '{{{ is not closed' : '{{ is not closed' };
      if (j > pos) tokens.push({ t: 0, s: src.slice(pos, j) });
      const content = trimST(src.slice(j + (raw ? 3 : 2), k));
      const path = validPath(content);
      if (!path) return { ok: false, reason: `"${content}" is not a path` };
      tokens.push({ t: 1, path, raw });
      pos = k + close.length;
      continue;
    }
    // {% ... %}
    const k = src.indexOf('%}', j + 2);
    if (k === -1) return { ok: false, reason: '{% is not closed' };
    const tagEnd = k + 2;
    const content = trimST(src.slice(j + 2, k));
    // Standalone on its line?
    const lineStart = src.lastIndexOf('\n', j - 1) + 1;
    let standalone = true;
    for (let p = lineStart; p < j; p++) {
      const c = src.charCodeAt(p);
      if (c !== 32 && c !== 9) {
        standalone = false;
        break;
      }
    }
    let lineEnd = src.indexOf('\n', tagEnd);
    if (lineEnd === -1) lineEnd = n;
    if (standalone) {
      for (let p = tagEnd; p < lineEnd; p++) {
        const c = src.charCodeAt(p);
        if (c !== 32 && c !== 9) {
          standalone = false;
          break;
        }
      }
    }
    if (standalone) {
      if (lineStart > pos) tokens.push({ t: 0, s: src.slice(pos, lineStart) });
      pos = lineEnd < n ? lineEnd + 1 : n;
    } else {
      if (j > pos) tokens.push({ t: 0, s: src.slice(pos, j) });
      pos = tagEnd;
    }
    const tag = parseTagContent(content);
    if (tag.kind === 'bad') return { ok: false, reason: tag.reason };
    tokens.push(tag);
  }
  // Build the tree.
  const root = [];
  const stack = [{ nodes: root, kind: 'root' }];
  for (const tok of tokens) {
    const top = stack[stack.length - 1];
    if (tok.t === 0 || tok.t === 1) {
      top.nodes.push(tok);
    } else if (tok.kind === 'include') {
      top.nodes.push({ t: 2, name: tok.name });
    } else if (tok.kind === 'for') {
      const node = { t: 3, var: tok.var, path: tok.path, body: [] };
      top.nodes.push(node);
      stack.push({ nodes: node.body, kind: 'for', node });
    } else if (tok.kind === 'if') {
      const node = { t: 4, path: tok.path, neg: tok.neg, then: [], els: null };
      top.nodes.push(node);
      stack.push({ nodes: node.then, kind: 'if', node, inElse: false });
    } else if (tok.kind === 'else') {
      if (top.kind !== 'if' || top.inElse) {
        return { ok: false, reason: '{% else %} closes nothing' };
      }
      top.node.els = [];
      top.nodes = top.node.els;
      top.inElse = true;
    } else if (tok.kind === 'endfor') {
      if (top.kind !== 'for') return { ok: false, reason: '{% endfor %} closes nothing' };
      stack.pop();
    } else if (tok.kind === 'endif') {
      if (top.kind !== 'if') return { ok: false, reason: '{% endif %} closes nothing' };
      stack.pop();
    }
  }
  if (stack.length !== 1) {
    const top = stack[stack.length - 1];
    return { ok: false, reason: top.kind === 'for' ? '{% for %} is not closed' : '{% if %} is not closed' };
  }
  return { ok: true, nodes: root };
}

function truthy(v) {
  return !(
    v === undefined ||
    v === null ||
    v === false ||
    v === '' ||
    v === 0 ||
    (Array.isArray(v) && v.length === 0)
  );
}

function writeValue(v, raw, out) {
  if (typeof v === 'string') {
    out.push(raw ? v : escHtml(v));
  } else if (typeof v === 'number') {
    out.push(String(v));
  } else if (typeof v === 'boolean') {
    out.push(v ? 'true' : 'false');
  } else if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(', ');
      writeValue(v[i], raw, out);
    }
  }
  // null, undefined and anything else write as "".
}

/**
 * A path's first name is read from the innermost loop that binds it (`loop`
 * before the element), else from the page's values; each next name is an own
 * property of the value so far, or the path is undefined.
 */
function resolvePath(scope, names) {
  const first = names[0];
  const frames = scope.frames;
  let v;
  if (first === 'loop') {
    v = frames.length > 0 ? frames[frames.length - 1].loop : scope.values.loop;
  } else {
    let found = false;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].v === first) {
        v = frames[i].val;
        found = true;
        break;
      }
    }
    if (!found) v = scope.values[first];
  }
  for (let k = 1; k < names.length; k++) {
    if (v === null || v === undefined) return undefined;
    const name = names[k];
    if (Object.hasOwn(v, name)) v = v[name];
    else return undefined;
  }
  return v;
}

const EMPTY_NODES = [];

function renderNodes(nodes, scope, tplMap, out, depth) {
  for (let n = 0; n < nodes.length; n++) {
    const nd = nodes[n];
    if (nd.t === 0) {
      out.push(nd.s);
    } else if (nd.t === 1) {
      writeValue(resolvePath(scope, nd.path), nd.raw, out);
    } else if (nd.t === 2) {
      if (depth < 8) {
        const tpl = tplMap.get(nd.name);
        if (tpl !== undefined) renderNodes(tpl, scope, tplMap, out, depth + 1);
      }
    } else if (nd.t === 3) {
      const arr = resolvePath(scope, nd.path);
      if (Array.isArray(arr)) {
        const len = arr.length;
        const loop = { index: 0, first: false, last: false, length: len };
        const frame = { v: nd.var, val: undefined, loop };
        scope.frames.push(frame);
        for (let k = 0; k < len; k++) {
          frame.val = arr[k];
          loop.index = k + 1;
          loop.first = k === 0;
          loop.last = k === len - 1;
          renderNodes(nd.body, scope, tplMap, out, depth);
        }
        scope.frames.pop();
      }
    } else {
      let c = truthy(resolvePath(scope, nd.path));
      if (nd.neg) c = !c;
      renderNodes(c ? nd.then : nd.els || EMPTY_NODES, scope, tplMap, out, depth);
    }
  }
}

// -------------------------------------------------------------------- build

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function sourceDir(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Resolve a relative link target from a source's directory, never above root. */
function resolveRel(dir, target) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = target.split('/');
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(s);
  }
  return parts.join('/');
}

function dedupTags(names, slugCache) {
  const seen = new Set();
  const out = [];
  for (const name of names) {
    const slug = slugify(name, slugCache);
    if (!seen.has(slug)) {
      seen.add(slug);
      out.push({ name, slug });
    }
  }
  return out;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  const site = input.site;
  const templates = input.templates;
  const files = input.files;
  const base = site.base_url.replace(/\/+$/, '');
  const slugCache = new Map();
  const report = new Set();

  // Templates, parsed in code-unit order of name; one that does not parse
  // is reported and left out, as if it were not there.
  const tplNames = Object.keys(templates).sort();
  const tplMap = new Map();
  for (const name of tplNames) {
    const p = parseTemplate(templates[name]);
    if (p.ok) tplMap.set(name, p.nodes);
    else report.add(`template "${name}": ${p.reason}`);
  }

  // Files sorted by path in code-unit order; a .md file is a source, the
  // rest are static. Sources have \r\n and lone \r made \n.
  const sorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const statics = [];
  const sources = [];
  for (const f of sorted) {
    if (f.path.endsWith('.md')) sources.push(f);
    else statics.push(f);
  }

  // Front matter and the checks, in order: refused, under tags/ or page/,
  // a post with no date, a layout no template has, a draft.
  const kept = [];
  for (const f of sources) {
    const lines = f.content.replace(/\r\n?/g, '\n').split('\n');
    const r = parseFrontMatter(lines);
    if (!r.ok) {
      report.add(`refused ${f.path}: ${r.reason}`);
      continue;
    }
    const fm = r.fm;
    const isPost = f.path.startsWith('posts/');
    const firstSeg = f.path.indexOf('/');
    const dir0 = firstSeg === -1 ? '' : f.path.slice(0, firstSeg);
    if (dir0 === 'tags' || dir0 === 'page') {
      report.add(`refused ${f.path}: ${dir0}/ is the generator's own`);
      continue;
    }
    if (isPost && fm.date === undefined) {
      report.add(`refused ${f.path}: a post needs a date`);
      continue;
    }
    const layout = fm.layout || (isPost ? 'post' : 'page');
    if (!tplMap.has(layout)) {
      report.add(`refused ${f.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    if (fm.draft === true) {
      report.add(`draft ${f.path}`);
      continue;
    }
    kept.push({ path: f.path, fm, isPost, layout, lines, bodyStart: r.bodyStart, srcDir: sourceDir(f.path) });
  }

  // Permalinks: a post's directory is posts/, a page's its source's
  // directory; the slug is its slug key or the slug of its title, made unique
  // in its directory in source order; at the root, posts, tags and page are
  // taken from the start.
  const takenByDir = new Map();
  function takenFor(dir) {
    let t = takenByDir.get(dir);
    if (!t) {
      t = new Set();
      if (dir === '') {
        t.add('posts');
        t.add('tags');
        t.add('page');
      }
      takenByDir.set(dir, t);
    }
    return t;
  }
  for (const p of kept) {
    const dir = p.isPost ? 'posts' : p.srcDir;
    const baseSlug = p.fm.slug || slugify(p.fm.title, slugCache);
    const slug = uniqueSlug(baseSlug, takenFor(dir));
    p.dir = dir;
    p.slug = slug;
    p.url = base + '/' + (dir === '' ? '' : dir + '/') + slug + '/';
    p.outPath = (dir === '' ? '' : dir + '/') + slug + '/index.html';
  }

  // Link targets: the url of the page built from a source, or <base>/<path>
  // of a static file.
  const pageBySource = new Map();
  for (const p of kept) pageBySource.set(p.path, p.url);
  const staticByPath = new Set();
  for (const f of statics) staticByPath.add(f.path);

  // Markdown, each source's body rendered to HTML, its links resolved.
  for (const p of kept) {
    const ctx = {
      resolveLink(target) {
        if (SCHEME_RE.test(target) || target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) {
          return target;
        }
        const hash = target.indexOf('#');
        const pathPart = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const resolved = resolveRel(p.srcDir, pathPart);
        const url = pageBySource.get(resolved);
        if (url !== undefined) return url + frag;
        if (staticByPath.has(resolved)) return base + '/' + resolved + frag;
        report.add(`broken-link ${p.path} -> ${target}`);
        return target;
      },
    };
    const r = renderBody(p.lines, p.bodyStart, ctx, slugCache);
    p.content = r.html;
    p.toc = r.toc;
    p.excerpt = r.excerpt;
    p.readingMinutes = Math.max(1, Math.ceil(countWords(p.lines, p.bodyStart) / 200));
  }

  // Collections: the posts, newest date first, equal dates by slug.
  const posts = kept.filter((p) => p.isPost);
  posts.sort((a, b) => {
    if (a.fm.date !== b.fm.date) return a.fm.date > b.fm.date ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  // Tags: each post's tags, each slug once, in its own order; a tag is all
  // the posts whose tags have its slug, named as first met walking the posts
  // in collection order; ordered by count, most first, then by slug.
  const tagMap = new Map();
  for (const p of kept) {
    p.tagNames = dedupTags(p.fm.tags || [], slugCache);
  }
  for (const post of posts) {
    for (const { name, slug } of post.tagNames) {
      let t = tagMap.get(slug);
      if (!t) {
        t = { name, slug, url: base + '/tags/' + slug + '/', count: 0, posts: [] };
        tagMap.set(slug, t);
      }
      t.count++;
      t.posts.push(post);
    }
  }
  const tags = [...tagMap.values()].sort(
    (a, b) => b.count - a.count || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  const scopeTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));

  function pageTagList(names) {
    const out = new Array(names.length);
    for (let i = 0; i < names.length; i++) {
      const t = tagMap.get(names[i].slug);
      out[i] = t ? { name: t.name, slug: names[i].slug, url: t.url } : { name: names[i].name, slug: names[i].slug, url: '' };
    }
    return out;
  }

  function makeCard(p) {
    return {
      title: p.fm.title,
      url: p.url,
      date: p.fm.date || '',
      date_long: p.fm.date ? dateLong(p.fm.date) : '',
      summary: p.fm.summary || '',
      excerpt: p.excerpt,
      reading_minutes: p.readingMinutes,
      tags: pageTagList(p.tagNames),
    };
  }

  for (const p of kept) {
    p.card = makeCard(p);
    p.page = {
      title: p.card.title,
      url: p.card.url,
      date: p.card.date,
      date_long: p.card.date_long,
      summary: p.card.summary,
      excerpt: p.card.excerpt,
      reading_minutes: p.card.reading_minutes,
      tags: p.card.tags,
      slug: p.slug,
      content: p.content,
      toc: p.toc,
      newer: null,
      older: null,
      is_post: p.isPost,
    };
  }
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (i > 0) {
      const q = posts[i - 1];
      p.page.newer = { title: q.fm.title, url: q.url, date: q.fm.date, date_long: dateLong(q.fm.date) };
    }
    if (i < posts.length - 1) {
      const q = posts[i + 1];
      p.page.older = { title: q.fm.title, url: q.url, date: q.fm.date, date_long: dateLong(q.fm.date) };
    }
  }

  const siteScope = { title: site.title, base_url: base };
  const recentCount = typeof site.recent === 'number' ? site.recent : 0;
  const recent = posts.slice(0, recentCount).map((p) => p.card);
  const out = Object.create(null);

  function renderTo(nodes, values) {
    const chunks = [];
    renderNodes(nodes, { values, frames: [] }, tplMap, chunks, 0);
    return chunks.join('');
  }

  // Layouts: every page through its layout, with `page`.
  let pagesWritten = 0;
  for (const p of kept) {
    const values = Object.create(null);
    values.site = siteScope;
    values.tags = scopeTags;
    values.recent = recent;
    values.page = p.page;
    out[p.outPath] = renderTo(tplMap.get(p.layout), values);
    if (!p.isPost) pagesWritten++;
  }

  // The index through `index`, site.per_page posts a page (at least one).
  const perPage = typeof site.per_page === 'number' && site.per_page >= 1 ? site.per_page : 1;
  const total = Math.max(1, Math.ceil(posts.length / perPage));
  if (tplMap.has('index')) {
    for (let pg = 1; pg <= total; pg++) {
      const values = Object.create(null);
      values.site = siteScope;
      values.tags = scopeTags;
      values.recent = recent;
      values.posts = posts.slice((pg - 1) * perPage, pg * perPage).map((p) => p.card);
      values.pager = {
        number: pg,
        total,
        url: pg === 1 ? base + '/' : base + '/page/' + pg + '/',
        newer_url: pg === 1 ? '' : pg === 2 ? base + '/' : base + '/page/' + (pg - 1) + '/',
        older_url: pg < total ? base + '/page/' + (pg + 1) + '/' : '',
      };
      out[pg === 1 ? 'index.html' : 'page/' + pg + '/index.html'] = renderTo(tplMap.get('index'), values);
    }
  }

  // Each tag through `tag`, and `tags/index.html` through `tags`.
  if (tplMap.has('tag')) {
    for (const t of tags) {
      const values = Object.create(null);
      values.site = siteScope;
      values.tags = scopeTags;
      values.recent = recent;
      values.tag = { name: t.name, slug: t.slug, url: t.url, count: t.count, posts: t.posts.map((p) => p.card) };
      out['tags/' + t.slug + '/index.html'] = renderTo(tplMap.get('tag'), values);
    }
  }
  if (tplMap.has('tags')) {
    const values = Object.create(null);
    values.site = siteScope;
    values.tags = scopeTags;
    values.recent = recent;
    out['tags/index.html'] = renderTo(tplMap.get('tags'), values);
  }

  // Each static file at its own path, unless a built page has its path.
  let staticsWritten = 0;
  for (const f of statics) {
    if (Object.hasOwn(out, f.path)) {
      report.add(`shadowed ${f.path}: a built page has its path`);
      continue;
    }
    out[f.path] = f.content;
    staticsWritten++;
  }

  // The report: every line reported above, sorted in code-unit order, then
  // the built line; every line ending in \n.
  const lines = [...report].sort();
  lines.push(`built ${pagesWritten} pages, ${posts.length} posts, ${tags.length} tags and ${staticsWritten} static files`);
  out['build-report.txt'] = lines.map((l) => l + '\n').join('');
  return out;
}
