import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toolText(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function toolError(error: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}
