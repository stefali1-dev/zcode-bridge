import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tools } from './tools.js';
import { VERSION } from './version.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'zcode-bridge', version: VERSION });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape },
      async (args: Record<string, unknown>) => {
        try {
          const result = (await tool.run(args as never)) as { imageBase64?: string } | undefined;
          const { imageBase64, ...rest } = result ?? {};
          const content: { type: 'text'; text: string }[] = [
            { type: 'text', text: JSON.stringify(rest, null, 1) },
          ];
          if (imageBase64) {
            content.push({ type: 'image', data: imageBase64, mimeType: 'image/png' } as never);
          }
          return { content };
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
        }
      },
    );
  }
  return server;
}
