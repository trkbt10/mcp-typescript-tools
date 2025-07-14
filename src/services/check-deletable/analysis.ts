import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import type { DeletableAnalysisResult } from '../../types';

export const analyzeFileDeletability = async (
  filePath: string,
  includeTypes: boolean = true
): Promise<DeletableAnalysisResult> => {
  let project: Project | undefined;

  try {
    // Verify the target file exists
    if (!fs.existsSync(filePath)) {
      return {
        filePath,
        isDeletable: false,
        error: `File not found: ${filePath}`,
        references: [],
        exports: [],
      };
    }

    const tsConfigPath = path.join(process.cwd(), 'tsconfig.json');
    const hasValidTsConfig = fs.existsSync(tsConfigPath);

    project = new Project({
      ...(hasValidTsConfig ? { tsConfigFilePath: tsConfigPath } : {}),
      useInMemoryFileSystem: false,
    });

    // Add all TypeScript files in the current directory
    project.addSourceFilesAtPaths('**/*.{ts,tsx}');

    // Ensure the target file is added - normalize path to handle symlinks
    const normalizedFilePath = fs.realpathSync(filePath);
    let targetFile = project.getSourceFile(normalizedFilePath) || project.getSourceFile(filePath);
    if (!targetFile) {
      try {
        targetFile = project.addSourceFileAtPath(filePath);
      } catch (addError) {
        return {
          filePath,
          isDeletable: false,
          error: `Unable to parse file: ${filePath}. ${addError}`,
          references: [],
          exports: [],
        };
      }
    }

    const references = await findAllReferences(targetFile, project, includeTypes);
    const exports = extractExports(targetFile);
    const isDeletable = references.length === 0;

    return {
      filePath,
      isDeletable,
      references,
      exports,
      summary: generateSummary(isDeletable, references),
    };
  } catch (error) {
    return {
      filePath,
      isDeletable: false,
      error: error instanceof Error ? error.message : String(error),
      references: [],
      exports: [],
    };
  } finally {
    // Clean up project resources
    if (project) {
      try {
        project.getModuleResolutionHost?.()?.clearCache?.();
        (project as any)._context?.compilerFactory?.removeCompilerApi?.();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
};

const extractExports = (targetFile: SourceFile): DeletableAnalysisResult['exports'] => {
  const exports: DeletableAnalysisResult['exports'] = [];

  // Extract named exports
  targetFile.getExportDeclarations().forEach(exportDecl => {
    const namedExports = exportDecl.getNamedExports();
    namedExports.forEach(namedExport => {
      exports.push({
        name: namedExport.getName(),
        type: 'variable', // Default to variable, refined below
        isTypeOnly: exportDecl.isTypeOnly(),
      });
    });
  });

  // Extract exported functions
  targetFile.getExportedDeclarations().forEach((declarations, name) => {
    declarations.forEach(declaration => {
      const kind = declaration.getKind();
      let type: DeletableAnalysisResult['exports'][0]['type'] = 'variable';
      
      switch (kind) {
        case SyntaxKind.FunctionDeclaration:
          type = 'function';
          break;
        case SyntaxKind.ClassDeclaration:
          type = 'class';
          break;
        case SyntaxKind.TypeAliasDeclaration:
          type = 'type';
          break;
        case SyntaxKind.InterfaceDeclaration:
          type = 'interface';
          break;
        case SyntaxKind.VariableDeclaration:
          type = 'variable';
          break;
      }

      // Check if this export already exists
      const existingExport = exports.find(exp => exp.name === name);
      if (existingExport) {
        existingExport.type = type;
      } else {
        exports.push({
          name,
          type,
          isTypeOnly: kind === SyntaxKind.TypeAliasDeclaration || kind === SyntaxKind.InterfaceDeclaration,
        });
      }
    });
  });

  // Extract default export
  const defaultExport = targetFile.getDefaultExportSymbol();
  if (defaultExport) {
    exports.push({
      name: 'default',
      type: 'default',
      isTypeOnly: false,
    });
  }

  return exports;
};

const findAllReferences = async (
  targetFile: SourceFile,
  project: Project,
  includeTypes: boolean
): Promise<DeletableAnalysisResult['references']> => {
  const references: DeletableAnalysisResult['references'] = [];
  const targetPath = targetFile.getFilePath();
  const targetPathVariations = getPathVariations(targetPath);
  
  // Also include non-normalized path variations to handle symlinks
  try {
    const originalPath = fs.realpathSync(targetPath);
    if (originalPath !== targetPath) {
      targetPathVariations.push(...getPathVariations(originalPath));
    }
  } catch {
    // Ignore if realpathSync fails
  }

  // Search through all source files in the project
  for (const sourceFile of project.getSourceFiles()) {
    // Skip the target file itself
    if (sourceFile === targetFile) continue;

    // Check for direct imports
    const directImportRefs = findDirectImportReferences(
      sourceFile,
      targetPathVariations,
      includeTypes
    );
    references.push(...directImportRefs);

    // Check for wildcard re-exports (export * from)
    const wildcardExportRefs = findWildcardExportReferences(
      sourceFile,
      targetPathVariations
    );
    references.push(...wildcardExportRefs);

    // Check for dynamic imports
    const dynamicImportRefs = findDynamicImportReferences(
      sourceFile,
      targetPathVariations
    );
    references.push(...dynamicImportRefs);
  }

  return references;
};

const findDirectImportReferences = (
  sourceFile: SourceFile,
  targetPathVariations: string[],
  includeTypes: boolean
): Array<DeletableAnalysisResult['references'][0]> => {
  const references: Array<DeletableAnalysisResult['references'][0]> = [];

  sourceFile.getImportDeclarations().forEach((importDecl) => {
    // Skip type-only imports if not including types
    if (!includeTypes && importDecl.isTypeOnly()) {
      return;
    }

    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    if (moduleSpecifier.startsWith('.')) {
      const resolvedPath = resolveModulePath(sourceFile, moduleSpecifier);
      
      if (resolvedPath && targetPathVariations.includes(resolvedPath)) {
        const start = importDecl.getStart();
        const pos = sourceFile.getLineAndColumnAtPos(start);
        
        // Extract imported names
        const importedNames: string[] = [];
        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport) {
          importedNames.push(`default as ${defaultImport.getText()}`);
        }
        
        const namespaceImport = importDecl.getNamespaceImport();
        if (namespaceImport) {
          importedNames.push(`* as ${namespaceImport.getText()}`);
        }
        
        const namedImports = importDecl.getNamedImports();
        namedImports.forEach(namedImport => {
          const name = namedImport.getName();
          const alias = namedImport.getAliasNode();
          if (alias) {
            importedNames.push(`${name} as ${alias.getText()}`);
          } else {
            importedNames.push(name);
          }
        });

        references.push({
          file: sourceFile.getFilePath(),
          line: pos.line,
          column: pos.column,
          type: 'import',
          text: importDecl.getText(),
          importedNames,
          isTypeOnly: importDecl.isTypeOnly(),
        });
      }
    }
  });

  return references;
};

const findWildcardExportReferences = (
  sourceFile: SourceFile,
  targetPathVariations: string[]
): Array<DeletableAnalysisResult['references'][0]> => {
  const references: Array<DeletableAnalysisResult['references'][0]> = [];

  sourceFile.getExportDeclarations().forEach((exportDecl) => {
    const moduleSpecifier = exportDecl.getModuleSpecifier();
    if (moduleSpecifier) {
      const moduleSpecifierValue = moduleSpecifier.getLiteralValue();
      if (moduleSpecifierValue.startsWith('.')) {
        const resolvedPath = resolveModulePath(sourceFile, moduleSpecifierValue);
        
        if (resolvedPath && targetPathVariations.includes(resolvedPath)) {
          const start = exportDecl.getStart();
          const pos = sourceFile.getLineAndColumnAtPos(start);
          
          // Check if it's a wildcard export (export * from './module')
          const exportText = exportDecl.getText();
          const isWildcard = exportText.includes('export *');
          
          references.push({
            file: sourceFile.getFilePath(),
            line: pos.line,
            column: pos.column,
            type: 'export',
            text: exportDecl.getText(),
            importedNames: isWildcard ? ['*'] : [],
            isTypeOnly: exportDecl.isTypeOnly(),
          });
        }
      }
    }
  });

  return references;
};

const findDynamicImportReferences = (
  sourceFile: SourceFile,
  targetPathVariations: string[]
): Array<DeletableAnalysisResult['references'][0]> => {
  const references: Array<DeletableAnalysisResult['references'][0]> = [];

  // Search for dynamic import() calls
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const callExpr = node.asKind(SyntaxKind.CallExpression);
      if (callExpr) {
        const expr = callExpr.getExpression();
        if (expr.getKind() === SyntaxKind.ImportKeyword) {
          const args = callExpr.getArguments();
          if (args.length > 0) {
            const firstArg = args[0];
            if (firstArg.getKind() === SyntaxKind.StringLiteral) {
              const moduleSpecifier = (firstArg as any).getLiteralValue();
              if (moduleSpecifier.startsWith('.')) {
                const resolvedPath = resolveModulePath(sourceFile, moduleSpecifier);
                
                if (resolvedPath && targetPathVariations.includes(resolvedPath)) {
                  const start = callExpr.getStart();
                  const pos = sourceFile.getLineAndColumnAtPos(start);
                  
                  references.push({
                    file: sourceFile.getFilePath(),
                    line: pos.line,
                    column: pos.column,
                    type: 'dynamic_import',
                    text: callExpr.getText(),
                    importedNames: [],
                    isTypeOnly: false,
                  });
                }
              }
            }
          }
        }
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
    resolvedPath + '.js',
    resolvedPath + '.jsx',
    path.join(resolvedPath, 'index.ts'),
    path.join(resolvedPath, 'index.tsx'),
    path.join(resolvedPath, 'index.js'),
    path.join(resolvedPath, 'index.jsx'),
  ];

  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      // Normalize the path to handle symlinks
      try {
        return fs.realpathSync(possiblePath);
      } catch {
        return possiblePath;
      }
    }
  }

  return undefined;
};

const getPathVariations = (filePath: string): string[] => {
  const variations = [filePath];
  
  // Add variation without extension
  const withoutExt = filePath.replace(/\.(ts|tsx|js|jsx)$/, '');
  if (withoutExt !== filePath) {
    variations.push(withoutExt);
  }
  
  // If it's an index file, add the directory path
  if (path.basename(filePath).startsWith('index.')) {
    variations.push(path.dirname(filePath));
  }

  return variations;
};

const generateSummary = (
  isDeletable: boolean,
  references: DeletableAnalysisResult['references']
): string => {
  if (isDeletable) {
    return 'File can be safely deleted - no references found';
  }

  const refCount = references.length;
  const fileCount = new Set(references.map(ref => ref.file)).size;
  const typeOnlyCount = references.filter(ref => ref.isTypeOnly).length;
  const dynamicImportCount = references.filter(ref => ref.type === 'dynamic_import').length;
  const wildcardCount = references.filter(ref => 
    ref.importedNames.includes('*') || ref.type === 'export'
  ).length;

  let summary = `Cannot delete - found ${refCount} reference${refCount === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`;
  
  if (typeOnlyCount > 0) {
    summary += `, ${typeOnlyCount} type-only`;
  }
  
  if (dynamicImportCount > 0) {
    summary += `, ${dynamicImportCount} dynamic import${dynamicImportCount === 1 ? '' : 's'}`;
  }
  
  if (wildcardCount > 0) {
    summary += `, ${wildcardCount} wildcard import/export${wildcardCount === 1 ? '' : 's'}`;
  }

  return summary;
};