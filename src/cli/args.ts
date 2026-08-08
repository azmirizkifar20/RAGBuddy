export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'search'; projectId: string; query: string }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, projectId, ...rest] = argv;
  if ((command === 'ingest' || command === 'sync') && projectId) {
    return { command, projectId };
  }
  if (command === 'search' && projectId && rest.length > 0) {
    return { command: 'search', projectId, query: rest.join(' ') };
  }
  return { command: 'unknown' };
}
