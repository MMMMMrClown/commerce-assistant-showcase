import type { ReactNode } from 'react';

// 【展示】仅解析运营回答所需的Markdown子集，React自动转义，不注入模型HTML。
function inline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
    part.startsWith('**') ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : part.startsWith('`') ? (
      <code
        key={index}
        className="break-all rounded bg-orange-50 px-1 text-xs text-orange-700 dark:bg-orange-950 dark:text-orange-200"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

export function AgentAnswer({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1]?.trim() || '')) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((v) => v.trim());
      const headings = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      blocks.push(
        <div
          key={i}
          className="my-4 overflow-x-auto rounded-lg border border-line dark:border-line"
        >
          <table className="w-full text-left text-sm">
            <thead className="bg-sunken dark:bg-sunken">
              <tr>
                {headings.map((h, j) => (
                  <th key={j} className="whitespace-nowrap px-4 py-3 font-medium">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} className="border-t border-line dark:border-line">
                  {row.map((cell, k) => (
                    <td key={k} className="px-4 py-2.5 tabular-nums">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^#{1,6}\s/.test(line))
      blocks.push(
        <h3 key={i} className="mb-2 mt-5 font-semibold">
          {inline(line.replace(/^#{1,6}\s/, ''))}
        </h3>,
      );
    else if (/^[-*]\s/.test(line))
      blocks.push(
        <div key={i} className="my-1 flex gap-2">
          <span className="text-orange-500">•</span>
          <p>{inline(line.slice(2))}</p>
        </div>,
      );
    else
      blocks.push(
        <p key={i} className="my-2">
          {inline(line)}
        </p>,
      );
  }
  return <div className="text-sm leading-7 text-ink ">{blocks}</div>;
}
