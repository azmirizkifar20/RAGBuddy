export type ParsedArgs = { command: 'ingest'; projectId: string } | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, projectId] = argv;
  if (command === 'ingest' && projectId) {
    return { command: 'ingest', projectId };
  }
  return { command: 'unknown' };
}
