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

### 3. File/Folder Rename (`rename_file_or_folder`)
Rename a file or folder and automatically update all import/export paths that reference it throughout the codebase.

**Parameters:**
- `sourcePath`: Path to the file or folder to rename
- `destinationPath`: New path for the file or folder
- `updateImports`: Whether to update import/export paths (default: true)

**Features:**
- **Cascade Import Updates**: Automatically updates all imports and exports that reference the renamed file/folder
- **Directory Support**: Can rename entire directories with all contained files
- **Path Style Preservation**: Maintains import style (with/without extensions, with/without /index)
- **Dynamic Import Support**: Updates dynamic `import()` statements in addition to static imports
- **Project-wide Scope**: Scans and updates all TypeScript files in the project

### 4. Dependency Analysis (`analyze_typescript_dependencies`)
Analyze file dependencies in both directions to understand code relationships.

**Parameters:**
- `filePath`: Path to the TypeScript file to analyze
- `direction`: Direction of analysis ('upstream' | 'downstream' | 'both')
  - `upstream`: Files that import the target file
  - `downstream`: Files that the target file imports
- `includeTypes`: Whether to include type-only imports (default: true)

### 5. Package.json Validation (`validate_package_json`)
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

### 6. Import Optimization (`optimize_imports`)
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

### 7. Conditional Optimization (`optimize_conditionals`)
Optimize conditional statements by converting if-else chains to switch statements, flattening nested conditions, and simplifying boolean expressions.

**Parameters:**
- `filePath`: Path to the TypeScript file to optimize
- `convertToSwitch`: Whether to convert if-else chains to switch statements (default: true)
- `flattenNestedConditions`: Whether to flatten nested if statements (default: true)
- `optimizeBoolean`: Whether to optimize boolean expressions (default: true)

**Optimizations include:**
- **If-Else to Switch**: Converts if-else chains with 3+ equality comparisons to switch statements
- **Nested Condition Flattening**: Combines nested if statements using logical operators
- **Boolean Expression Simplification**: Removes redundant boolean comparisons and double negations

### 8. Dependency Visualization (`visualize_dependencies`)
Generate dependency graph visualization with circular dependency detection and module boundary analysis.

**Parameters:**
- `rootPath`: Root path of the project to analyze
- `format`: Output format ('mermaid' | 'json' | 'dot', default: 'mermaid')
- `includeNodeModules`: Whether to include node_modules in analysis (default: false)
- `maxDepth`: Maximum directory depth to analyze (default: 10)
- `detectCircular`: Whether to detect circular dependencies (default: true)

**Features include:**
- **Dependency Graph Generation**: Creates visual dependency graphs in Mermaid, DOT, or JSON format
- **Circular Dependency Detection**: Identifies and reports circular dependencies with severity levels
- **Module Boundary Analysis**: Analyzes import/export relationships and module structure
- **Statistics**: Provides metrics on file count, import count, dependency depth, and circular dependencies

### 9. Deletion Safety Check (`check_deletable`)
Analyze if a TypeScript file can be safely deleted by detecting all references to it throughout the codebase, including complex patterns like wildcard imports and re-exports.

**Parameters:**
- `filePath`: Path to the TypeScript file to check for deletion safety
- `includeTypes`: Whether to include type-only imports in analysis (default: true)
- `generateTests`: Whether to generate a `[name].spec.ts` test file in the same folder (default: false)
- `createMocks`: Whether to create `__mocks__` folder structure with mock files (default: false)

**Features include:**
- **Comprehensive Reference Detection**: Finds all imports, exports, and dynamic imports that reference the target file
- **Wildcard Import/Export Support**: Detects `export * from './file'` and namespace imports like `import * as Module from './file'`
- **Type-Only Import Handling**: Can optionally exclude or include type-only imports in the analysis
- **Test File Generation**: Generates deletion safety test files with detailed analysis and usage simulation
- **Mock Structure Creation**: Creates `__mocks__` folder with mock implementations for testing deletion scenarios
- **Two-Phase Analysis**: Separates analysis phase from execution phase for better control and testing

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