// Keeps only the formatting a note can hold. Everything else is unwrapped
// (its text kept) or, for active content, dropped entirely.

const KEEP = new Set(['P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'PRE', 'CODE', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'UL', 'OL', 'LI', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BLOCKQUOTE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);
const SAFE_URL = /^(https?:|mailto:)/i;

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName.toUpperCase();
    if (DROP.has(tag)) { child.remove(); continue; }
    clean(child);
    if (!KEEP.has(tag)) {
      // Headings beyond h3 become subheadings; other unknown tags unwrap.
      if (/^H[4-6]$/.test(tag)) {
        const h = child.ownerDocument.createElement('h3');
        h.append(...child.childNodes);
        child.replaceWith(h);
      } else {
        child.replaceWith(...child.childNodes);
      }
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      const ok =
        (name === 'href' && tag === 'A' && SAFE_URL.test(attr.value.trim())) ||
        (name === 'class' && tag === 'UL' && /^(checklist|dashed)$/.test(attr.value)) ||
        (name === 'data-checked' && tag === 'LI' && attr.value === 'true');
      if (!ok) child.removeAttribute(attr.name);
    }
  }
}

export function sanitize(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}
