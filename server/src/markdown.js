// A small Markdown renderer for blog posts. Everything is HTML-escaped first,
// then a fixed set of constructs is turned into tags, so a post can never
// carry raw HTML or scripts. Links and images must be http(s) or site-relative.
//
// Supported: ## headings (# is shown as ##; the page title is the only h1),
// paragraphs, **bold**, *italic*, `code`, ```code blocks```, > quotes,
// - / * / 1. lists, --- rules, [links](url) and ![images](url).

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function safeUrl(url) {
  const u = url.trim();
  return /^https?:\/\//i.test(u) || (u.startsWith('/') && !u.startsWith('//')) ? u : null;
}

function inline(text) {
  // Code spans first, kept out of the other rules.
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'));
    return u ? `<img src="${esc(u)}" alt="${alt}" loading="lazy">` : m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'));
    if (!u) return m;
    const external = /^https?:/i.test(u);
    return `<a href="${esc(u)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushPara(); flushList();
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      flushPara(); flushList();
      const level = Math.min(4, Math.max(2, h[1].length + (h[1].length === 1 ? 1 : 0)));
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushPara(); flushList();
      const quote = [q[1]];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) quote.push(lines[++i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((ul ?? ol)[1]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

/** Plain text of a post, for descriptions and reading time. */
export function plainText(md) {
  return String(md ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_-]/g, ' ').replace(/\s+/g, ' ').trim();
}
