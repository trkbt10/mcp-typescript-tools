import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export type ClaudeDesktopConfig = {
  mcpServers: {
    [key: string]: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
};

export const generateMcpServerConfig = async (
  serverName: string = 'typescript-tools',
  projectPath?: string
): Promise<void> => {
  const resolvedProjectPath = projectPath || process.cwd();
  const executablePath = path.join(resolvedProjectPath, 'ts-tools');

  // Claude Desktop configuration for MCP servers
  const config: ClaudeDesktopConfig = {
    mcpServers: {
      [serverName]: {
        command: executablePath,
        args: [],
      },
    },
  };

  // Get Claude Desktop config path based on OS
  const getConfigPath = (): string => {
    const platform = process.platform;
    const homeDir = os.homedir();

    switch (platform) {
      case 'darwin': // macOS
        return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      case 'win32': // Windows
        return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
      default: // Linux and others
        return path.join(homeDir, '.config', 'claude', 'claude_desktop_config.json');
    }
  };

  const configPath = getConfigPath();

  // Create directory if it doesn't exist
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  // Read existing config if it exists
  let existingConfig: ClaudeDesktopConfig = { mcpServers: {} };
  try {
    const existingContent = await fs.readFile(configPath, 'utf-8');
    existingConfig = JSON.parse(existingContent);
  } catch (error) {
    // File doesn't exist or is invalid, use empty config
  }

  // Merge with existing config
  const mergedConfig: ClaudeDesktopConfig = {
    ...existingConfig,
    mcpServers: {
      ...existingConfig.mcpServers,
      ...config.mcpServers,
    },
  };

  // Write the config
  await fs.writeFile(configPath, JSON.stringify(mergedConfig, null, 2));
  
  console.log(`MCP server configuration added to: ${configPath}`);
  console.log(`Server name: ${serverName}`);
  console.log(`\nYou can now use TypeScript tools in Claude Desktop!`);
};

// Generate a standalone config snippet for manual installation
export const generateMcpConfigSnippet = async (
  serverName: string = 'typescript-tools',
  projectPath?: string
): Promise<void> => {
  const resolvedProjectPath = projectPath || process.cwd();
  const executablePath = path.join(resolvedProjectPath, 'ts-tools');

  const snippet: ClaudeDesktopConfig = {
    mcpServers: {
      [serverName]: {
        command: executablePath,
        args: [],
      },
    },
  };

  const outputPath = path.join(resolvedProjectPath, 'mcp-config.json');
  await fs.writeFile(outputPath, JSON.stringify(snippet, null, 2));

  console.log(`Generated MCP config snippet at: ${outputPath}`);
  console.log('\nTo install, add this configuration to your Claude Desktop config:');
  console.log(`- macOS: ~/Library/Application Support/Claude/claude_desktop_config.json`);
  console.log(`- Windows: %APPDATA%\\Claude\\claude_desktop_config.json`);
  console.log(`- Linux: ~/.config/claude/claude_desktop_config.json`);
};

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0] || 'snippet';
  const serverName = args[1] || 'typescript-tools';

  if (command === 'install') {
    generateMcpServerConfig(serverName).catch(console.error);
  } else {
    generateMcpConfigSnippet(serverName).catch(console.error);
  }
}