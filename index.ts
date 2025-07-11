#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { moveTypeScriptFile } from './src/services/file-move/index';
import { renameSymbol } from './src/services/rename/index';
import { analyzeDependencies } from './src/services/dependency-analysis/index';
import { validatePackage } from './src/services/package-validation/index';
import { optimizeImports } from './src/services/import-optimization/index';
import { generateMcpConfigSnippet, generateMcpServerConfig } from './src/utils/generate-config';

const server = new Server(
  {
    name: 'typescript-tools-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'move_typescript_file',
        description: 'Move a TypeScript file and update all import paths automatically',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Source file path',
            },
            destination: {
              type: 'string',
              description: 'Destination file path',
            },
            updateImports: {
              type: 'boolean',
              description: 'Whether to update import paths (default: true)',
              default: true,
            },
          },
          required: ['source', 'destination'],
        },
      },
      {
        name: 'rename_typescript_symbol',
        description: 'Rename a variable, function, type, interface, or class and update all references',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the file containing the symbol',
            },
            oldName: {
              type: 'string',
              description: 'Current name of the symbol',
            },
            newName: {
              type: 'string',
              description: 'New name for the symbol',
            },
            type: {
              type: 'string',
              enum: ['variable', 'function', 'type', 'interface', 'class'],
              description: 'Type of the symbol to rename',
            },
          },
          required: ['filePath', 'oldName', 'newName', 'type'],
        },
      },
      {
        name: 'analyze_typescript_dependencies',
        description: 'Analyze dependencies of a TypeScript file (upstream: files that import this file, downstream: files this file imports)',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the TypeScript file to analyze',
            },
            direction: {
              type: 'string',
              enum: ['upstream', 'downstream', 'both'],
              description: 'Direction of dependency analysis',
            },
            includeTypes: {
              type: 'boolean',
              description: 'Whether to include type-only imports (default: true)',
              default: true,
            },
          },
          required: ['filePath', 'direction'],
        },
      },
      {
        name: 'validate_package_json',
        description: 'Validate package.json file for type resolution, file existence, exports, and typesVersions configuration',
        inputSchema: {
          type: 'object',
          properties: {
            packageJsonPath: {
              type: 'string',
              description: 'Path to the package.json file to validate',
            },
            checkTypes: {
              type: 'boolean',
              description: 'Whether to check TypeScript type resolution (default: true)',
              default: true,
            },
            checkExports: {
              type: 'boolean',
              description: 'Whether to validate exports field (default: true)',
              default: true,
            },
            checkTypesVersions: {
              type: 'boolean',
              description: 'Whether to validate typesVersions field (default: true)',
              default: true,
            },
          },
          required: ['packageJsonPath'],
        },
      },
      {
        name: 'optimize_imports',
        description: 'Optimize TypeScript import statements by removing unused imports, consolidating duplicates, separating types, and optimizing paths',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the TypeScript file to optimize',
            },
            removeUnused: {
              type: 'boolean',
              description: 'Whether to remove unused imports (default: true)',
              default: true,
            },
            optimizeIndexPaths: {
              type: 'boolean',
              description: 'Whether to remove /index suffixes from import paths (default: true)',
              default: true,
            },
            consolidateImports: {
              type: 'boolean',
              description: 'Whether to consolidate multiple imports from the same module (default: true)',
              default: true,
            },
            separateTypeImports: {
              type: 'boolean',
              description: 'Whether to separate type and value imports using import type (default: true)',
              default: true,
            },
          },
          required: ['filePath'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'move_typescript_file': {
        const result = await moveTypeScriptFile(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'rename_typescript_symbol': {
        const result = await renameSymbol(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'analyze_typescript_dependencies': {
        const result = await analyzeDependencies(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'validate_package_json': {
        const result = await validatePackage(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'optimize_imports': {
        const result = await optimizeImports(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
    };
  }
});

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--generate-config') || args.includes('--config')) {
  const flagIndex = args.includes('--generate-config') ? args.indexOf('--generate-config') : args.indexOf('--config');
  const serverName = (flagIndex !== -1 && args[flagIndex + 1] && !args[flagIndex + 1].startsWith('--')) 
    ? args[flagIndex + 1] 
    : 'typescript-tools';
  generateMcpConfigSnippet(serverName).then(() => process.exit(0)).catch((err) => {
    console.error('Failed to generate config:', err);
    process.exit(1);
  });
} else if (args.includes('--install-config')) {
  const flagIndex = args.indexOf('--install-config');
  const serverName = (flagIndex !== -1 && args[flagIndex + 1] && !args[flagIndex + 1].startsWith('--'))
    ? args[flagIndex + 1]
    : 'typescript-tools';
  generateMcpServerConfig(serverName).then(() => process.exit(0)).catch((err) => {
    console.error('Failed to install config:', err);
    process.exit(1);
  });
} else {
  const transport = new StdioServerTransport();
  server.connect(transport);

  console.error('TypeScript Tools MCP Server running on stdio');
}