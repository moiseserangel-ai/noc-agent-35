import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';

function InlineText({ children }) {
  const parts = String(children).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return part;
  });
}

function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="agent-code">
      <div className="agent-code-header">
        <span>{language || 'comando'}</span>
        <button type="button" onClick={copy} aria-label="Copiar código">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

function parseMarkdown(content) {
  const blocks = [];
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^```([\w.+-]*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      blocks.push({ type: 'code', language: fence[1], value: code.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, value: heading[2] });
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*]\s+/, ''));
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+\.\s+/, ''));
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', value: quote.join('\n') });
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: 'divider' });
      index += 1;
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(?:```|#{1,3}\s|>\s?|---+$|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    blocks.push({ type: 'paragraph', value: paragraph.join('\n') });
  }
  return blocks;
}

export default function AgentResponse({ content }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  return (
    <div className="agent-response">
      {blocks.map((block, index) => {
        if (block.type === 'code') return <CodeBlock key={index} language={block.language}>{block.value}</CodeBlock>;
        if (block.type === 'heading') {
          const Tag = `h${block.level + 2}`;
          return <Tag key={index}><InlineText>{block.value}</InlineText></Tag>;
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return <Tag key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText>{item}</InlineText></li>)}</Tag>;
        }
        if (block.type === 'quote') return <blockquote key={index}><InlineText>{block.value}</InlineText></blockquote>;
        if (block.type === 'divider') return <hr key={index} />;
        return <p key={index}><InlineText>{block.value}</InlineText></p>;
      })}
    </div>
  );
}
