import { Project, SourceFile, ImportDeclaration, SyntaxKind, ts } from 'ts-morph';
import { glob } from 'glob';
import { dirname, relative, resolve, basename, extname } from 'path';
import { existsSync, readFileSync } from 'fs';

export type ImportPathRepairOptions = {
  filePath: string;
  dryRun?: boolean;
  includeTypes?: boolean;
  respectTsConfig?: boolean;
  prioritizeCloserPaths?: boolean;
};

export type ImportPathRepairResult = {
  filePath: string;
  repairedImports: RepairResult[];
  errors: string[];
  totalImportsChecked: number;
  totalImportsRepaired: number;
};

export type RepairResult = {
  originalPath: string;
  repairedPath: string | null;
  importType: 'named' | 'default' | 'namespace' | 'side-effect';
  namedImports?: string[];
  status: 'repaired' | 'not_found' | 'multiple_matches' | 'already_valid';
  candidateFiles?: string[];
  selectedFile?: string;
  reason?: string;
};

type FileMatch = {
  path: string;
  exports: Set<string>;
  hasDefault: boolean;
  distance: number;
  similarity: number;
};

export async function repairImportPaths(options: ImportPathRepairOptions): Promise<ImportPathRepairResult> {
  const {
    filePath,
    dryRun = false,
    includeTypes = true,
    respectTsConfig = true,
    prioritizeCloserPaths = true,
  } = options;

  const tsConfigPath = respectTsConfig ? findTsConfig(filePath) : undefined;
  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    // Add the directory containing the file to ensure we can find it
    ...(tsConfigPath ? {} : { compilerOptions: {} })
  });

  // Set the root directory if we have a tsconfig
  if (tsConfigPath) {
    const tsConfigDir = dirname(tsConfigPath);
    project.addSourceFilesAtPaths(`${tsConfigDir}/**/*.{ts,tsx}`);
  }

  const sourceFile = project.addSourceFileAtPath(filePath);
  const result: ImportPathRepairResult = {
    filePath,
    repairedImports: [],
    errors: [],
    totalImportsChecked: 0,
    totalImportsRepaired: 0,
  };

  try {
    const importDeclarations = sourceFile.getImportDeclarations();
    result.totalImportsChecked = importDeclarations.length;

    for (const importDecl of importDeclarations) {
      const repairResult = await repairSingleImport(sourceFile, importDecl, project, {
        includeTypes,
        prioritizeCloserPaths,
      });

      result.repairedImports.push(repairResult);

      if (repairResult.status === 'repaired' && repairResult.repairedPath) {
        if (!dryRun) {
          importDecl.setModuleSpecifier(repairResult.repairedPath);
        }
        result.totalImportsRepaired++;
      }
    }

    if (!dryRun && result.totalImportsRepaired > 0) {
      await sourceFile.save();
    }
  } catch (error) {
    result.errors.push(`Failed to repair imports: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

async function repairSingleImport(
  sourceFile: SourceFile,
  importDecl: ImportDeclaration,
  project: Project,
  options: { includeTypes: boolean; prioritizeCloserPaths: boolean }
): Promise<RepairResult> {
  const originalPath = importDecl.getModuleSpecifierValue();
  const currentFilePath = sourceFile.getFilePath();

  // Skip node_modules imports
  if (!originalPath.startsWith('.') && !originalPath.startsWith('/')) {
    return {
      originalPath,
      repairedPath: null,
      importType: getImportType(importDecl),
      status: 'already_valid',
      reason: 'External module import',
    };
  }

  // Check if current path is valid
  const resolvedPath = resolveImportPath(currentFilePath, originalPath);
  if (resolvedPath && existsSync(resolvedPath)) {
    return {
      originalPath,
      repairedPath: null,
      importType: getImportType(importDecl),
      status: 'already_valid',
      reason: 'Path already valid',
    };
  }

  // Extract file name from broken path
  const fileName = getFileNameFromPath(originalPath);
  if (!fileName) {
    return {
      originalPath,
      repairedPath: null,
      importType: getImportType(importDecl),
      status: 'not_found',
      reason: 'Cannot extract filename from path',
    };
  }

  // Find candidate files
  const candidateFiles = await findFilesByName(fileName, project);
  if (candidateFiles.length === 0) {
    return {
      originalPath,
      repairedPath: null,
      importType: getImportType(importDecl),
      status: 'not_found',
      reason: 'No matching files found',
    };
  }

  // Analyze imports to get required exports
  const namedImports = getNamedImports(importDecl);
  const importType = getImportType(importDecl);

  // Score and filter candidates
  const scoredCandidates = await scoreCandidates(
    candidateFiles,
    currentFilePath,
    namedImports,
    importType,
    options.prioritizeCloserPaths
  );

  const bestCandidate = selectBestCandidate(scoredCandidates, namedImports, importType);
  
  if (!bestCandidate) {
    return {
      originalPath,
      repairedPath: null,
      importType,
      namedImports,
      status: 'not_found',
      candidateFiles: candidateFiles.map(f => f.path),
      reason: 'No suitable candidate found',
    };
  }

  // Generate relative path
  const repairedPath = generateRelativePath(currentFilePath, bestCandidate.path);

  return {
    originalPath,
    repairedPath,
    importType,
    namedImports,
    status: 'repaired',
    candidateFiles: candidateFiles.map(f => f.path),
    selectedFile: bestCandidate.path,
    reason: `Selected based on ${namedImports.length > 0 ? 'export matching' : 'proximity'}`,
  };
}

function getImportType(importDecl: ImportDeclaration): RepairResult['importType'] {
  const importClause = importDecl.getImportClause();
  if (!importClause) return 'side-effect';

  if (importClause.getNamespaceImport()) return 'namespace';
  if (importClause.getDefaultImport()) return 'default';
  if (importClause.getNamedBindings()) return 'named';
  
  return 'side-effect';
}

function getNamedImports(importDecl: ImportDeclaration): string[] {
  const importClause = importDecl.getImportClause();
  if (!importClause) return [];

  const namedBindings = importClause.getNamedBindings();
  if (!namedBindings || namedBindings.getKind() !== SyntaxKind.NamedImports) return [];

  return namedBindings.asKindOrThrow(SyntaxKind.NamedImports)
    .getElements()
    .map(element => element.getName());
}

function resolveImportPath(currentFilePath: string, importPath: string): string | null {
  try {
    const currentDir = dirname(currentFilePath);
    const resolved = resolve(currentDir, importPath);
    
    // Try various extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];
    
    for (const ext of extensions) {
      if (existsSync(resolved + ext)) return resolved + ext;
    }
    
    // Try index files
    for (const ext of extensions) {
      const indexPath = resolve(resolved, `index${ext}`);
      if (existsSync(indexPath)) return indexPath;
    }
    
    return null;
  } catch {
    return null;
  }
}

function getFileNameFromPath(importPath: string): string | null {
  // Remove extension and index suffix
  let fileName = basename(importPath);
  
  // Remove common extensions
  fileName = fileName.replace(/\.(ts|tsx|js|jsx|d\.ts)$/, '');
  
  // If it's just 'index', get the parent directory name
  if (fileName === 'index') {
    const parentDir = basename(dirname(importPath));
    return parentDir || null;
  }
  
  return fileName || null;
}

async function findFilesByName(fileName: string, project: Project): Promise<FileMatch[]> {
  // Get the project root directory
  const rootDir = project.getRootDirectories()[0]?.getPath() || process.cwd();
  
  const patterns = [
    `**/${fileName}.ts`,
    `**/${fileName}.tsx`,
    `**/${fileName}.js`,
    `**/${fileName}.jsx`,
    `**/${fileName}.d.ts`,
    `**/${fileName}/index.ts`,
    `**/${fileName}/index.tsx`,
    `**/${fileName}/index.js`,
    `**/${fileName}/index.jsx`,
  ];

  const allFiles: string[] = [];
  const excludes = ['node_modules/**', 'dist/**', '**/*.spec.ts', '**/*.test.ts'];
  
  for (const pattern of patterns) {
    try {
      const files = await glob(pattern, {
        cwd: rootDir,
        ignore: excludes,
        absolute: true,
      });
      allFiles.push(...files);
    } catch (error) {
      // Continue with other patterns
    }
  }

  // Remove duplicates and create FileMatch objects
  const uniqueFiles = [...new Set(allFiles)];
  const fileMatches: FileMatch[] = [];

  for (const filePath of uniqueFiles) {
    try {
      const sourceFile = project.addSourceFileAtPathIfExists(filePath);
      if (!sourceFile) continue;

      const exports = getFileExports(sourceFile);
      const hasDefault = hasDefaultExport(sourceFile);

      fileMatches.push({
        path: filePath,
        exports,
        hasDefault,
        distance: 0, // Will be calculated later
        similarity: calculateSimilarity(fileName, basename(filePath, extname(filePath))),
      });
    } catch (error) {
      // Skip files that can't be parsed
    }
  }

  return fileMatches;
}

function getFileExports(sourceFile: SourceFile): Set<string> {
  const exports = new Set<string>();

  // Get named exports
  sourceFile.getExportDeclarations().forEach(exportDecl => {
    const namedExports = exportDecl.getNamedExports();
    namedExports.forEach(namedExport => {
      exports.add(namedExport.getName());
    });
  });

  // Get exported functions, classes, etc.
  sourceFile.getExportedDeclarations().forEach((declarations, name) => {
    if (name !== 'default') {
      exports.add(name);
    }
  });

  return exports;
}

function hasDefaultExport(sourceFile: SourceFile): boolean {
  return sourceFile.getDefaultExportSymbol() !== undefined;
}

async function scoreCandidates(
  candidates: FileMatch[],
  currentFilePath: string,
  requiredExports: string[],
  importType: RepairResult['importType'],
  prioritizeCloserPaths: boolean
): Promise<FileMatch[]> {
  return candidates.map(candidate => {
    // Calculate distance (directory levels difference)
    const currentDir = dirname(currentFilePath);
    const candidateDir = dirname(candidate.path);
    const distance = calculateDirectoryDistance(currentDir, candidateDir);

    return {
      ...candidate,
      distance,
    };
  });
}

function selectBestCandidate(
  candidates: FileMatch[],
  requiredExports: string[],
  importType: RepairResult['importType']
): FileMatch | null {
  if (candidates.length === 0) return null;

  // Filter by export requirements
  let filteredCandidates = candidates;

  if (importType === 'default') {
    filteredCandidates = candidates.filter(c => c.hasDefault);
  } else if (importType === 'named' && requiredExports.length > 0) {
    filteredCandidates = candidates.filter(c => 
      requiredExports.every(exportName => c.exports.has(exportName))
    );
  }

  // If no candidates match the export requirements, fall back to all candidates
  if (filteredCandidates.length === 0) {
    filteredCandidates = candidates;
  }

  // Sort by priority: export match > distance > similarity
  filteredCandidates.sort((a, b) => {
    // First, prioritize files that have the required exports
    const aHasExports = importType === 'default' ? 
      (a.hasDefault ? 1 : 0) : 
      requiredExports.every(exp => a.exports.has(exp)) ? 1 : 0;
    
    const bHasExports = importType === 'default' ? 
      (b.hasDefault ? 1 : 0) : 
      requiredExports.every(exp => b.exports.has(exp)) ? 1 : 0;

    if (aHasExports !== bHasExports) {
      return bHasExports - aHasExports;
    }

    // Then by distance (closer is better)
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }

    // Finally by name similarity
    return b.similarity - a.similarity;
  });

  return filteredCandidates[0] || null;
}

function calculateDirectoryDistance(dir1: string, dir2: string): number {
  const relativePath = relative(dir1, dir2);
  const parts = relativePath.split('/').filter(part => part !== '.');
  
  // Count ".." (going up) and regular directory names
  return parts.reduce((count, part) => {
    return part === '..' ? count + 2 : count + 1; // Going up costs more
  }, 0);
}

function calculateSimilarity(str1: string, str2: string): number {
  // Simple similarity score based on common characters
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0 && len2 === 0) return 1;
  if (len1 === 0 || len2 === 0) return 0;

  // Exact match
  if (str1 === str2) return 1;

  // Count common characters
  let common = 0;
  const chars1 = str1.toLowerCase().split('');
  const chars2 = str2.toLowerCase().split('');

  for (const char of chars1) {
    const index = chars2.indexOf(char);
    if (index !== -1) {
      common++;
      chars2.splice(index, 1);
    }
  }

  return common / Math.max(len1, len2);
}

function generateRelativePath(fromFile: string, toFile: string): string {
  const fromDir = dirname(fromFile);
  let relativePath = relative(fromDir, toFile);
  
  // Remove extension
  relativePath = relativePath.replace(/\.(ts|tsx|js|jsx|d\.ts)$/, '');
  
  // Ensure it starts with ./ for relative imports
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }
  
  return relativePath;
}

function findTsConfig(filePath: string): string | undefined {
  let currentDir = dirname(filePath);
  
  while (currentDir !== '/') {
    const tsConfigPath = resolve(currentDir, 'tsconfig.json');
    if (existsSync(tsConfigPath)) {
      return tsConfigPath;
    }
    currentDir = dirname(currentDir);
  }
  
  return undefined;
}