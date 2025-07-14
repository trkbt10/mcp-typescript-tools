export type FileMoveOptions = {
  source: string;
  destination: string;
  updateImports?: boolean;
};

export type FileMoveResult = {
  success: boolean;
  updatedFiles?: string[];
  error?: string;
};

export type RenameOptions = {
  filePath: string;
  oldName: string;
  newName: string;
  type: 'variable' | 'function' | 'type' | 'interface' | 'class';
};

export type RenameResult = {
  success: boolean;
  updatedFiles?: string[];
  error?: string;
};

export type DependencyDirection = 'upstream' | 'downstream' | 'both';

export type DependencyAnalysisOptions = {
  filePath: string;
  direction: DependencyDirection;
  includeTypes?: boolean;
};

export type DependencyInfo = {
  filePath: string;
  imports: string[];
  exports: string[];
  references: Array<{
    file: string;
    line: number;
    column: number;
    text: string;
  }>;
};

export type DependencyAnalysisResult = {
  target: string;
  dependencies: DependencyInfo[];
  error?: string;
};

export type FileRenameOptions = {
  sourcePath: string;
  destinationPath: string;
  updateImports?: boolean;
};

export type FileRenameResult = {
  success: boolean;
  error?: string;
  updatedFiles?: string[];
  affectedImports?: Array<{
    file: string;
    oldImport: string;
    newImport: string;
  }>;
  isDirectory?: boolean;
};

export type PackageValidationOptions = {
  packageJsonPath: string;
  checkTypes?: boolean;
  checkExports?: boolean;
  checkTypesVersions?: boolean;
};

export type FileResolutionInfo = {
  field: string;
  value: string;
  resolvedPath?: string;
  exists: boolean;
  isDirectory?: boolean;
  error?: string;
};

export type ExportsValidationInfo = {
  path: string;
  condition?: string;
  resolvedFile?: string;
  exists: boolean;
  error?: string;
};

export type TypesVersionsValidationInfo = {
  version: string;
  paths: Array<{
    pattern: string;
    mappings: string[];
    resolved: Array<{
      file: string;
      exists: boolean;
    }>;
  }>;
};

export type PackageValidationResult = {
  packagePath: string;
  isValid: boolean;
  issues: string[];
  warnings: string[];
  fileResolution: FileResolutionInfo[];
  exportsValidation?: ExportsValidationInfo[];
  typesVersionsValidation?: TypesVersionsValidationInfo[];
  error?: string;
};

export type ImportOptimizationOptions = {
  filePath: string;
  removeUnused?: boolean;
  optimizeIndexPaths?: boolean;
  consolidateImports?: boolean;
  separateTypeImports?: boolean;
};

export type ImportOptimizationChange = {
  type: 'removed' | 'consolidated' | 'separated' | 'optimized_path';
  originalImport: string;
  newImport?: string;
  reason: string;
};

export type ImportOptimizationResult = {
  filePath: string;
  optimized: boolean;
  changes: ImportOptimizationChange[];
  optimizedCode?: string;
  error?: string;
};

export type ConditionalOptimizationOptions = {
  filePath: string;
  convertToSwitch?: boolean;
  flattenNestedConditions?: boolean;
  optimizeBoolean?: boolean;
};

export type ConditionalOptimization = {
  type: 'if_to_switch' | 'flatten_nested' | 'boolean_optimization';
  originalCode: string;
  optimizedCode: string;
  reason: string;
  lineNumber: number;
};

export type ConditionalOptimizationResult = {
  filePath: string;
  optimized: boolean;
  optimizations: ConditionalOptimization[];
  optimizedCode?: string;
  error?: string;
};

export type DependencyVisualizationOptions = {
  rootPath: string;
  format?: 'mermaid' | 'json' | 'dot';
  includeNodeModules?: boolean;
  maxDepth?: number;
  detectCircular?: boolean;
};

export type DependencyNode = {
  id: string;
  filePath: string;
  type: 'file' | 'directory' | 'external';
  imports: string[];
  exports: string[];
  size?: number;
};

export type CircularDependency = {
  cycle: string[];
  severity: 'warning' | 'error';
  suggestion?: string;
};

export type DependencyVisualizationResult = {
  format: string;
  content: string;
  nodes: DependencyNode[];
  circularDependencies?: CircularDependency[];
  statistics: {
    totalFiles: number;
    totalImports: number;
    maxDepth: number;
    circularCount: number;
  };
  error?: string;
};