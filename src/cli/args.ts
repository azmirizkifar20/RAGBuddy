export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'sync-all' }
  | { command: 'search'; projectId: string; query: string }
  | { command: 'ask'; projectId: string; query: string }
  | { command: 'mcp' }
  | { command: 'hook'; action: 'install' | 'uninstall'; projectId: string }
  | { command: 'project'; action: 'list' }
  | { command: 'project'; action: 'remove'; id: string }
  | { command: 'project'; action: 'register'; id: string; repository: string; name?: string; paths?: string[] }
  | { command: 'web'; port?: number }
  | { command: 'qdrant'; action: 'drop-collection'; confirmed: boolean }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...restArgs] = argv;

  if (command === 'mcp') {
    return { command: 'mcp' };
  }

  if (command === 'web') {
    const portIndex = restArgs.indexOf('--port');
    const port = portIndex !== -1 && restArgs[portIndex + 1] ? Number(restArgs[portIndex + 1]) : undefined;
    return { command: 'web', port };
  }

  if (command === 'hook') {
    const [action, projectId] = restArgs;
    if ((action === 'install' || action === 'uninstall') && projectId) {
      return { command: 'hook', action, projectId };
    }
    return { command: 'unknown' };
  }

  if (command === 'project') {
    const [action, ...projectArgs] = restArgs;
    if (action === 'list') {
      return { command: 'project', action: 'list' };
    }
    if (action === 'remove' && projectArgs[0]) {
      return { command: 'project', action: 'remove', id: projectArgs[0] };
    }
    if (action === 'register' && projectArgs[0] && projectArgs[1]) {
      const [id, repository, ...flags] = projectArgs;
      const { name, paths } = parseProjectFlags(flags);
      return { command: 'project', action: 'register', id, repository, name, paths };
    }
    return { command: 'unknown' };
  }

  if (command === 'qdrant') {
    const [action, ...flags] = restArgs;
    if (action === 'drop-collection') {
      return { command: 'qdrant', action: 'drop-collection', confirmed: flags.includes('--yes') };
    }
    return { command: 'unknown' };
  }

  if (command === 'sync-all') {
    return { command: 'sync-all' };
  }

  if ((command === 'ingest' || command === 'sync') && restArgs[0]) {
    return { command, projectId: restArgs[0] };
  }

  if (command === 'search' && restArgs[0] && restArgs.length > 1) {
    return { command: 'search', projectId: restArgs[0], query: restArgs.slice(1).join(' ') };
  }

  if (command === 'ask' && restArgs[0] && restArgs.length > 1) {
    return { command: 'ask', projectId: restArgs[0], query: restArgs.slice(1).join(' ') };
  }

  return { command: 'unknown' };
}

function parseProjectFlags(flags: string[]): { name?: string; paths?: string[] } {
  let name: string | undefined;
  let paths: string[] | undefined;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--name' && flags[i + 1]) {
      name = flags[i + 1];
      i++;
    } else if (flags[i] === '--paths' && flags[i + 1]) {
      paths = flags[i + 1]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      i++;
    }
  }
  return { name, paths };
}
