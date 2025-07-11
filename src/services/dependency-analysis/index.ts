import { Project, SourceFile, Node, ImportDeclaration, ExportDeclaration } from 'ts-morph';
import * as path from 'path';
import type { DependencyAnalysisOptions, DependencyAnalysisResult, DependencyInfo } from '../../types';

export const analyzeDependencies = async (
  options: DependencyAnalysisOptions
): Promise<DependencyAnalysisResult> => {
  const { filePath, direction, includeTypes = true } = options;

  try {
    const project = new Project({
      tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
    });

    const targetFile = project.getSourceFile(filePath);
    if (!targetFile) {
      return {
        target: filePath,
        dependencies: [],
        error: `File not found: ${filePath}`,
      };
    }

    const dependencies: DependencyInfo[] = [];

    if (direction === 'downstream' || direction === 'both') {
      const downstreamDeps = await getDownstreamDependencies(targetFile, project, includeTypes);
      dependencies.push(...downstreamDeps);
    }

    if (direction === 'upstream' || direction === 'both') {
      const upstreamDeps = await getUpstreamDependencies(targetFile, project, includeTypes);
      dependencies.push(...upstreamDeps);
    }

    return {
      target: filePath,
      dependencies: removeDuplicates(dependencies),
    };
  } catch (error) {
    return {
      target: filePath,
      dependencies: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const getDownstreamDependencies = async (
  targetFile: SourceFile,
  project: Project,
  includeTypes: boolean
): Promise<DependencyInfo[]> => {
  const dependencies: DependencyInfo[] = [];
  const targetPath = targetFile.getFilePath();

  const imports = targetFile.getImportDeclarations();
  const importedFiles = new Set<string>();

  for (const importDecl of imports) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    
    if (!includeTypes && importDecl.isTypeOnly()) {
      continue;
    }

    if (moduleSpecifier.startsWith('.')) {
      const resolvedPath = resolveModulePath(targetFile, moduleSpecifier);
      if (resolvedPath) {
        importedFiles.add(resolvedPath);
      }
    }
  }

  for (const importedPath of importedFiles) {
    const importedFile = project.getSourceFile(importedPath);
    if (importedFile) {
      const info = createDependencyInfo(importedFile, targetFile);
      dependencies.push(info);
    }
  }

  return dependencies;
};

const getUpstreamDependencies = async (
  targetFile: SourceFile,
  project: Project,
  includeTypes: boolean
): Promise<DependencyInfo[]> => {
  const dependencies: DependencyInfo[] = [];
  const targetPath = targetFile.getFilePath();
  const targetPathVariations = getPathVariations(targetPath);

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile === targetFile) continue;

    let importsTarget = false;
    const imports: string[] = [];

    sourceFile.getImportDeclarations().forEach((importDecl) => {
      if (!includeTypes && importDecl.isTypeOnly()) {
        return;
      }

      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      if (moduleSpecifier.startsWith('.')) {
        const resolvedPath = resolveModulePath(sourceFile, moduleSpecifier);
        
        if (resolvedPath && targetPathVariations.includes(resolvedPath)) {
          importsTarget = true;
          const namedImports = importDecl.getNamedImports().map(n => n.getName());
          const defaultImport = importDecl.getDefaultImport();
          
          if (defaultImport) {
            imports.push(defaultImport.getText());
          }
          imports.push(...namedImports);
        }
      }
    });

    if (importsTarget) {
      const info = createDependencyInfo(sourceFile, targetFile);
      info.imports = imports;
      dependencies.push(info);
    }
  }

  return dependencies;
};

const createDependencyInfo = (
  sourceFile: SourceFile,
  referencedFile: SourceFile
): DependencyInfo => {
  const filePath = sourceFile.getFilePath();
  const exports = sourceFile.getExportedDeclarations();
  const exportNames: string[] = [];

  exports.forEach((declarations, name) => {
    exportNames.push(name);
  });

  const references = findReferences(sourceFile, referencedFile);

  return {
    filePath,
    imports: [],
    exports: exportNames,
    references,
  };
};

const findReferences = (
  sourceFile: SourceFile,
  targetFile: SourceFile
): DependencyInfo['references'] => {
  const references: DependencyInfo['references'] = [];
  const targetPath = targetFile.getFilePath();
  const targetPathVariations = getPathVariations(targetPath);

  sourceFile.getImportDeclarations().forEach((importDecl) => {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    if (moduleSpecifier.startsWith('.')) {
      const resolvedPath = resolveModulePath(sourceFile, moduleSpecifier);
      
      if (resolvedPath && targetPathVariations.includes(resolvedPath)) {
        const start = importDecl.getStart();
        const pos = sourceFile.getLineAndColumnAtPos(start);
        
        references.push({
          file: sourceFile.getFilePath(),
          line: pos.line,
          column: pos.column,
          text: importDecl.getText(),
        });
      }
    }
  });

  return references;
};

const resolveModulePath = (
  sourceFile: SourceFile,
  moduleSpecifier: string
): string | undefined => {
  const sourceDir = path.dirname(sourceFile.getFilePath());
  const resolvedPath = path.resolve(sourceDir, moduleSpecifier);

  const possiblePaths = [
    resolvedPath,
    resolvedPath + '.ts',
    resolvedPath + '.tsx',
    path.join(resolvedPath, 'index.ts'),
    path.join(resolvedPath, 'index.tsx'),
  ];

  const fs = require('fs');
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      return possiblePath;
    }
  }

  return undefined;
};

const getPathVariations = (filePath: string): string[] => {
  const variations = [filePath];
  
  if (filePath.endsWith('/index.ts') || filePath.endsWith('/index.tsx')) {
    variations.push(path.dirname(filePath));
  }
  
  const withoutExt = filePath.replace(/\.(ts|tsx)$/, '');
  if (withoutExt !== filePath) {
    variations.push(withoutExt);
  }

  return variations;
};

const removeDuplicates = (dependencies: DependencyInfo[]): DependencyInfo[] => {
  const seen = new Set<string>();
  return dependencies.filter((dep) => {
    if (seen.has(dep.filePath)) {
      return false;
    }
    seen.add(dep.filePath);
    return true;
  });
};