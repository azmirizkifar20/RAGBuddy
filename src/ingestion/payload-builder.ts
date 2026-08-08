import type { Chunk } from './chunker';

export function deriveCategory(relativePath: string, paths: string[]): string {
  for (const configuredPath of paths) {
    const prefix = configuredPath.endsWith('/') ? configuredPath : `${configuredPath}/`;
    if (relativePath.startsWith(prefix)) {
      const rest = relativePath.slice(prefix.length);
      const slashIndex = rest.indexOf('/');
      return slashIndex === -1 ? 'root' : rest.slice(0, slashIndex);
    }
  }
  return 'other';
}

export function composeEmbedText(chunk: Chunk): string {
  return `${chunk.title}\n${chunk.section}\n${chunk.content}`;
}
