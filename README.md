# TypeScript Tools MCP

A Model Context Protocol (MCP) server that provides TypeScript development tools for automated refactoring and code analysis.

## Features

### 1. File Move with Import Updates (`move_typescript_file`)
Move TypeScript files while automatically updating all import paths across your codebase.

**Parameters:**
- `source`: Source file path
- `destination`: Destination file path
- `updateImports`: Whether to update import paths (default: true)

**Features:**
- **Smart Index File Handling**: When moving `index.ts` files, imports are updated to reference the directory instead of the full path
  - `./utils/index` → `./helpers` (when moving `utils/index.ts` to `helpers/index.ts`)
- **Automatic Path Resolution**: Handles various file extensions (`.ts`, `.tsx`) and index file patterns
- **Project-wide Updates**: Scans and updates all TypeScript files in the project

### 2. Symbol Rename (`rename_typescript_symbol`)
Rename variables, functions, types, interfaces, or classes with automatic reference updates throughout the codebase.

**Parameters:**
- `filePath`: Path to the file containing the symbol
- `oldName`: Current name of the symbol
- `newName`: New name for the symbol
- `type`: Type of symbol ('variable' | 'function' | 'type' | 'interface' | 'class')

### 3. Dependency Analysis (`analyze_typescript_dependencies`)
Analyze file dependencies in both directions to understand code relationships.

**Parameters:**
- `filePath`: Path to the TypeScript file to analyze
- `direction`: Direction of analysis ('upstream' | 'downstream' | 'both')
  - `upstream`: Files that import the target file
  - `downstream`: Files that the target file imports
- `includeTypes`: Whether to include type-only imports (default: true)

### 4. Package.json Validation (`validate_package_json`)
Validate package.json configuration for type resolution, file existence, and proper exports setup.

**Parameters:**
- `packageJsonPath`: Path to the package.json file to validate
- `checkTypes`: Whether to check TypeScript type resolution (default: true)
- `checkExports`: Whether to validate exports field (default: true)
- `checkTypesVersions`: Whether to validate typesVersions field (default: true)

**Validation includes:**
- **File Resolution**: Validates that `main`, `module`, `browser`, `types`, `bin` fields point to existing files
- **Type Resolution**: Checks if types are properly configured and accessible
- **Exports Validation**: Ensures all export paths resolve to existing files
- **TypesVersions**: Validates typesVersions mappings for different TypeScript versions

### 5. Import Optimization (`optimize_imports`)
Optimize TypeScript import statements by removing unused imports, consolidating duplicates, separating types, and optimizing paths.

**Parameters:**
- `filePath`: Path to the TypeScript file to optimize
- `removeUnused`: Whether to remove unused imports (default: true)
- `optimizeIndexPaths`: Whether to remove /index suffixes from import paths (default: true)
- `consolidateImports`: Whether to consolidate multiple imports from the same module (default: true)
- `separateTypeImports`: Whether to separate type and value imports using `import type` (default: true)

**Optimizations include:**
- **Unused Import Removal**: Removes unused named imports and entire unused import statements
- **Index Path Optimization**: Converts `./utils/index` to `./utils` automatically
- **Import Consolidation**: Merges multiple import statements from the same module
- **Type Import Separation**: Separates type imports using `import type { Type }` syntax for better tree-shaking

## Installation

```bash
bun install
```

## Installation

```bash
bun install
bun run build
```

## Command Line Usage

After building, you can use the `ts-tools` command directly:

```bash
# Make it available globally (optional)
ln -s /path/to/typescript-tools-mcp/ts-tools /usr/local/bin/ts-tools

# Or use it directly
./ts-tools

# Generate MCP config
./ts-tools --generate-config [server-name]

# Install to Claude Desktop
./ts-tools --install-config [server-name]
```

## Configuration

### For Claude Desktop

1. **Generate configuration snippet:**
```bash
# Generate mcp-config.json
bun run config:generate

# Or with custom server name
bun run index.ts --generate-config my-ts-tools
```

2. **Automatic installation (macOS/Windows/Linux):**
```bash
# Install directly to Claude Desktop config
bun run config:install

# Or with custom server name
bun run index.ts --install-config my-ts-tools
```

3. **Manual installation:**
Add the generated configuration from `mcp-config.json` to your Claude Desktop config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/claude/claude_desktop_config.json`

## Development

```bash
# Run in development mode
bun run dev

# Build for production
bun run build

# Run tests
bun run test
```

## Requirements

- Bun runtime
- TypeScript project with tsconfig.json
- Node.js compatible environment