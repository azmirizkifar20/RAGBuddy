export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'search'; projectId: string; query: string }
  | { command: 'mcp' }
  | { command: 'hook'; action: 'install' | 'uninstall'; projectId: string }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...restArgs] = argv;

  if (command === 'mcp') {
    return { command: 'mcp' };
  }

  if (command === 'hook') {
    const [action, projectId] = restArgs;
    if ((action === 'install' || action === 'uninstall') && projectId) {
      return { command: 'hook', action, projectId };
    }
    return { command: 'unknown' };
  }

  if ((command === 'ingest' || command === 'sync') && restArgs[0]) {
    return { command, projectId: restArgs[0] };
  }

  if (command === 'search' && restArgs[0] && restArgs.length > 1) {
    return { command: 'search', projectId: restArgs[0], query: restArgs.slice(1).join(' ') };
  }

  return { command: 'unknown' };
}
