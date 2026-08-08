export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, projectId] = argv;
  if ((command === 'ingest' || command === 'sync') && projectId) {
    return { command, projectId };
  }
  return { command: 'unknown' };
}
