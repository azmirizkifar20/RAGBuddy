import { describe, it, expect } from 'vitest';
import { toolText, toolError } from '../../src/mcp/tool-result';

describe('toolText', () => {
  it('wraps text in a content array', () => {
    expect(toolText('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });
});

describe('toolError', () => {
  it('wraps an Error message with isError true', () => {
    expect(toolError(new Error('boom'))).toEqual({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    });
  });

  it('stringifies a non-Error value', () => {
    expect(toolError('plain string')).toEqual({
      content: [{ type: 'text', text: 'plain string' }],
      isError: true,
    });
  });
});
