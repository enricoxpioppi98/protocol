#!/usr/bin/env node
/**
 * Protocol MCP server — stdio transport.
 *
 * Boot sequence:
 *   1. Importing ./supabase eagerly resolves and validates env (will throw a
 *      descriptive error to stderr if any of SUPABASE_URL /
 *      SUPABASE_SERVICE_ROLE_KEY / PROTOCOL_USER_ID is missing).
 *   2. Construct the SDK Server, register a ListTools and a CallTool handler.
 *   3. Connect the StdioServerTransport. Claude Desktop runs `node dist/index.js`
 *      as a subprocess and speaks JSON-RPC over stdin/stdout — so writes to
 *      stdout MUST be the SDK's; everything diagnostic goes to stderr.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ALL_TOOLS } from './tools.js';
// Side-effect import: validates env at startup and surfaces config errors
// before the SDK starts speaking JSON-RPC.
import './supabase.js';

const SERVER_NAME = 'protocol-mcp';
const SERVER_VERSION = '0.1.0';

async function main(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  // --- tools/list — advertise the four read-only tools to Claude Desktop ---
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // --- tools/call — dispatch by name, validate args with zod, run handler ---
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const tool = ALL_TOOLS.find((t) => t.name === name);

    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      };
    }

    // zod parse turns missing/wrong types into a friendly error string the
    // model can correct on retry, instead of a stack trace.
    const parsed = tool.zodSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Invalid arguments for ${name}: ${issues}`,
          },
        ],
      };
    }

    try {
      // The cast is safe: each tool's zodSchema produces the input type for
      // its own run() method. TS can't see that across the union, so we widen
      // the run signature to (any) → ToolResult and let the SDK serialize.
      type AnyRun = (a: unknown) => Promise<{
        content: Array<{ type: 'text'; text: string }>;
        isError?: boolean;
      }>;
      const result = await (tool.run as unknown as AnyRun)(parsed.data);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log the stack to stderr for the operator; return only the message to
      // the model so we don't leak file paths.
      console.error(`[protocol-mcp] tool ${name} failed:`, err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Tool ${name} failed: ${msg}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr is safe here — Claude Desktop's MCP log captures it.
  console.error(`[protocol-mcp] connected on stdio (v${SERVER_VERSION})`);
}

main().catch((err) => {
  console.error('[protocol-mcp] fatal:', err);
  process.exit(1);
});
