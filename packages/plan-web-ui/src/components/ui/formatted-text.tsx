import type { ReactNode } from "react";

function pushTextNodes(chunk: string, nodes: ReactNode[], keyPrefix: string) {
  const lines = chunk.split("\n");

  lines.forEach((line, index) => {
    if (index > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    }
    if (line) {
      nodes.push(line);
    }
  });
}

function renderInline(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  const regex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let tokenIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushTextNodes(text.slice(lastIndex, match.index), nodes, `${keyPrefix}-${tokenIndex}`);
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a key={`${keyPrefix}-link-${tokenIndex}`} href={match[3]} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline">
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${tokenIndex}`} className="font-semibold text-[var(--text)]">{match[4]}</strong>);
    } else if (match[5]) {
      nodes.push(<code key={`${keyPrefix}-code-${tokenIndex}`} className="rounded-md border border-[var(--border)] px-1.5 py-0.5 font-mono text-[0.95em] text-[var(--text)]">{match[5]}</code>);
    } else if (match[6]) {
      nodes.push(<em key={`${keyPrefix}-em-${tokenIndex}`} className="italic">{match[6]}</em>);
    }

    lastIndex = regex.lastIndex;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    pushTextNodes(text.slice(lastIndex), nodes, `${keyPrefix}-tail`);
  }

  return nodes;
}

function renderBlock(block: string, index: number): ReactNode {
  const lines = block.split("\n");

  // Fenced code block
  if (block.startsWith("```")) {
    const code = block.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
    return (
      <pre key={`code-${index}`} className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-sm font-mono text-[var(--text)]">
        <code>{code}</code>
      </pre>
    );
  }

  // Heading
  const headingMatch = block.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch && headingMatch[2]) {
    const level = headingMatch[1]?.length ?? 1;
    const content = headingMatch[2];
    const cls =
      level <= 2
        ? "text-base font-bold text-[var(--text)]"
        : "text-sm font-bold text-[var(--text)]";
    return (
      <p key={`h-${index}`} className={cls}>
        {renderInline(content, `h-${index}`)}
      </p>
    );
  }

  // Blockquote
  if (lines.every((line) => /^\s*>\s?/.test(line))) {
    return (
      <blockquote key={`bq-${index}`} className="border-l-2 border-[var(--accent)] pl-4 text-sm italic text-[var(--text-muted)]">
        {lines.map((line, lineIndex) => (
          <div key={`bq-${index}-${lineIndex}`}>
            {renderInline(line.replace(/^\s*>\s?/, ""), `bq-${index}-${lineIndex}`)}
          </div>
        ))}
      </blockquote>
    );
  }

  // Horizontal rule
  if (/^\s*([-*_])\1{2,}\s*$/.test(block.trim())) {
    return <hr key={`hr-${index}`} className="border-[var(--border)]" />;
  }

  // Unordered list
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return (
      <ul key={`ul-${index}`} className="grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
        {lines.map((line, lineIndex) => (
          <li key={`ul-${index}-${lineIndex}`} className="list-disc">
            {renderInline(line.replace(/^\s*[-*]\s+/, ""), `ul-${index}-${lineIndex}`)}
          </li>
        ))}
      </ul>
    );
  }

  // Ordered list
  if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    return (
      <ol key={`ol-${index}`} className="grid gap-2 pl-5 text-sm text-[var(--text-muted)] list-decimal">
        {lines.map((line, lineIndex) => (
          <li key={`ol-${index}-${lineIndex}`}>
            {renderInline(line.replace(/^\s*\d+\.\s+/, ""), `ol-${index}-${lineIndex}`)}
          </li>
        ))}
      </ol>
    );
  }

  // Paragraph
  return (
    <p key={`p-${index}`} className="text-sm leading-6 text-[var(--text-muted)] whitespace-pre-wrap">
      {renderInline(block, `p-${index}`)}
    </p>
  );
}

export function FormattedText({ text, className = "" }: { text: string; className?: string }) {
  if (!text?.trim()) return null;
  const blocks = text.trim().split(/\n\s*\n/).filter(Boolean);

  return (
    <div className={`grid gap-3 ${className}`}>
      {blocks.map((block, blockIndex) => renderBlock(block, blockIndex))}
    </div>
  );
}