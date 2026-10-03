import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, List, ListOrdered, Quote, Link2, Link2Off } from 'lucide-react';

// Small rich-text editor for the blog description. Produces plain article
// HTML (paragraphs, headings, lists, quotes, links). The server sanitises
// whatever is saved, so this component is about writing comfort, not safety.

const KEEP = new Set(['P', 'BR', 'H2', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'IFRAME', 'OBJECT', 'SVG', 'IMG', 'NOSCRIPT']);

// Pasted HTML (Word, Google Docs, other sites) arrives full of inline styles
// and wrapper spans — keep the structure, drop everything else.
function cleanPastedHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node, out) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out.appendChild(document.createTextNode(child.textContent));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || DROP.has(child.tagName)) return;
      let tag = child.tagName;
      if (tag === 'H1') tag = 'H2';
      if (tag === 'DIV') tag = 'P';
      if (!KEEP.has(tag)) { walk(child, out); return; }
      const el = document.createElement(tag);
      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:|tel:)/i.test(href)) el.setAttribute('href', href);
      }
      walk(child, el);
      out.appendChild(el);
    });
  };
  const holder = document.createElement('div');
  walk(doc.body, holder);
  return holder.innerHTML;
}

function ToolButton({ label, onAction, children }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // mousedown, not click: keeps the text selection in the editor alive.
      onMouseDown={(e) => { e.preventDefault(); onAction(); }}
      className="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium text-ink-soft hover:bg-cream-deep hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-terracotta"
    >
      {children}
    </button>
  );
}

export default function RichText({ value, onChange, id, labelledBy }) {
  const ref = useRef(null);
  const [empty, setEmpty] = useState(!value);

  // Uncontrolled: the DOM is the source of truth while typing. Only load the
  // value in when it changes from outside (opening a different post).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || '';
      setEmpty(!ref.current.textContent.trim());
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const isEmpty = !el.textContent.trim();
    setEmpty(isEmpty);
    onChange(isEmpty ? '' : el.innerHTML);
  };

  // Browsers leave the first line of an empty editor as bare text; start it
  // as a real paragraph so every block is a <p>, heading or list.
  const onFocus = () => {
    const el = ref.current;
    if (!el) return;
    document.execCommand('defaultParagraphSeparator', false, 'p');
    if (!el.textContent.trim() && !el.querySelector('li')) {
      el.innerHTML = '<p><br></p>';
      const range = document.createRange();
      range.setStart(el.firstChild, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const run = (command, arg) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt('Link address (https://…)');
    if (!url) return;
    const href = /^(https?:|mailto:|tel:|\/)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    run('createLink', href);
  };

  const onPaste = (e) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    if (html) document.execCommand('insertHTML', false, cleanPastedHtml(html));
    else document.execCommand('insertText', false, text);
    emit();
  };

  return (
    <div className="rounded-xl border border-border bg-white focus-within:border-terracotta focus-within:ring-2 focus-within:ring-terracotta/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5" role="toolbar" aria-label="Formatting">
        <ToolButton label="Normal text" onAction={() => run('formatBlock', 'P')}>Text</ToolButton>
        <ToolButton label="Heading" onAction={() => run('formatBlock', 'H2')}>Heading</ToolButton>
        <ToolButton label="Sub-heading" onAction={() => run('formatBlock', 'H3')}>Sub-heading</ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Bold" onAction={() => run('bold')}><Bold className="h-4 w-4" /></ToolButton>
        <ToolButton label="Italic" onAction={() => run('italic')}><Italic className="h-4 w-4" /></ToolButton>
        <ToolButton label="Bulleted list" onAction={() => run('insertUnorderedList')}><List className="h-4 w-4" /></ToolButton>
        <ToolButton label="Numbered list" onAction={() => run('insertOrderedList')}><ListOrdered className="h-4 w-4" /></ToolButton>
        <ToolButton label="Quote" onAction={() => run('formatBlock', 'BLOCKQUOTE')}><Quote className="h-4 w-4" /></ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Add link" onAction={addLink}><Link2 className="h-4 w-4" /></ToolButton>
        <ToolButton label="Remove link" onAction={() => run('unlink')}><Link2Off className="h-4 w-4" /></ToolButton>
      </div>
      <div className="relative">
        {empty && (
          <div className="pointer-events-none absolute left-4 top-3 text-ink-soft/60" aria-hidden>
            Write the article here…
          </div>
        )}
        <div
          id={id}
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={labelledBy}
          contentEditable
          suppressContentEditableWarning
          onFocus={onFocus}
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          className="blog-body min-h-[320px] px-4 py-3 outline-none"
        />
      </div>
    </div>
  );
}
