export interface MarkdownSection {
  title: string;
  heading: string;
  level: number;
  content: string;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;

export function parseMarkdown(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];

  let currentLines: string[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let documentTitle = '';
  let started = false;
  let inFence = false;

  const flush = () => {
    if (!started && currentLines.every((line) => line.trim() === '')) return;
    sections.push({
      title: documentTitle,
      heading: currentHeading,
      level: currentLevel,
      content: currentLines.join('\n'),
    });
  };

  for (const line of lines) {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      currentLines.push(line);
      continue;
    }
    if (inFence) {
      currentLines.push(line);
      continue;
    }
    const match = HEADING_PATTERN.exec(line);
    if (match) {
      flush();
      currentLevel = match[1].length;
      currentHeading = match[2];
      if (currentLevel === 1 && !documentTitle) {
        documentTitle = currentHeading;
      }
      currentLines = [line];
      started = true;
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}
