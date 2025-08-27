import { Project, SourceFile, ImportDeclaration, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs/promises';
import type {
  ImportOptimizationOptions,
  ImportOptimizationResult,
  ImportOptimizationChange,
} from '../../types';

export const optimizeImports = async (
  options: ImportOptimizationOptions
): Promise<ImportOptimizationResult> => {
  const {
    filePath,
    removeUnused = true,
    optimizeIndexPaths = true,
    consolidateImports = true,
    separateTypeImports = true,
  } = options;
  let project: Project | undefined;

  try {
    project = new Project({
      useInMemoryFileSystem: false,
      compilerOptions: {
        allowJs: true,
        target: 99, // ESNext
      },
    });

    const sourceFile = project.addSourceFileAtPath(filePath);
    const changes: ImportOptimizationChange[] = [];

    // Store original content for comparison
    const originalContent = sourceFile.getFullText();

    // 1. Optimize index paths first (before consolidation)
    if (optimizeIndexPaths) {
      await optimizeIndexImportPaths(sourceFile, changes);
    }

    // 2. Consolidate imports from same module
    if (consolidateImports) {
      await consolidateImportsFromSameModule(sourceFile, changes);
    }

    // 3. Remove unused imports (after consolidation)
    if (removeUnused) {
      await removeUnusedImports(sourceFile, changes);
    }

    // 4. Separate type imports
    if (separateTypeImports) {
      await separateTypeAndValueImports(sourceFile, changes);
    }

    const optimizedCode = sourceFile.getFullText();
    const hasChanges = optimizedCode !== originalContent;

    if (hasChanges) {
      await sourceFile.save();
    }

    return {
      filePath,
      optimized: hasChanges,
      changes,
      optimizedCode: hasChanges ? optimizedCode : undefined,
    };
  } catch (error) {
    return {
      filePath,
      optimized: false,
      changes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Clean up project resources
    if (project) {
      try {
        const host = project.getModuleResolutionHost?.();
        if (host && 'clearCache' in host && typeof host.clearCache === 'function') {
          host.clearCache();
        }
        (project as any)._context?.compilerFactory?.removeCompilerApi?.();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
};

const removeUnusedImports = async (
  sourceFile: SourceFile,
  changes: ImportOptimizationChange[]
): Promise<void> => {
  const importDeclarations = sourceFile.getImportDeclarations().slice(); // Copy to avoid modification during iteration

  for (const importDecl of importDeclarations) {
    // Skip type-only imports for now
    if (importDecl.isTypeOnly()) {
      continue;
    }

    const namedImports = importDecl.getNamedImports();
    const defaultImport = importDecl.getDefaultImport();
    const namespaceImport = importDecl.getNamespaceImport();

    let hasUsedImports = false;
    const usedNamedImports: string[] = [];

    // Check default import usage
    if (defaultImport) {
      const defaultImportName = defaultImport.getText();
      if (isIdentifierUsed(sourceFile, defaultImportName, importDecl)) {
        hasUsedImports = true;
      } else {
        // Remove unused default import
        changes.push({
          type: 'removed',
          originalImport: `default import: ${defaultImportName}`,
          reason: `Unused default import: ${defaultImportName}`,
        });
      }
    }

    // Check namespace import usage
    if (namespaceImport) {
      const namespaceImportName = namespaceImport.getText();
      if (isIdentifierUsed(sourceFile, namespaceImportName, importDecl)) {
        hasUsedImports = true;
      }
    }

    // Check named imports usage
    for (const namedImport of namedImports) {
      const importName = namedImport.getName();
      if (isIdentifierUsed(sourceFile, importName, importDecl)) {
        hasUsedImports = true;
        usedNamedImports.push(importName);
      }
    }

    // Remove unused named imports
    if (namedImports.length > 0 && usedNamedImports.length < namedImports.length) {
      const unusedImports = namedImports.filter(
        (ni) => !usedNamedImports.includes(ni.getName())
      );

      for (const unusedImport of unusedImports) {
        changes.push({
          type: 'removed',
          originalImport: unusedImport.getText(),
          reason: `Unused named import: ${unusedImport.getName()}`,
        });
        unusedImport.remove();
      }
      
      if (usedNamedImports.length > 0) {
        hasUsedImports = true;
      }
    }

    // Remove entire import if nothing is used
    if (!hasUsedImports) {
      changes.push({
        type: 'removed',
        originalImport: importDecl.getText(),
        reason: 'Entire import statement unused',
      });
      importDecl.remove();
    }
  }
};

const optimizeIndexImportPaths = async (
  sourceFile: SourceFile,
  changes: ImportOptimizationChange[]
): Promise<void> => {
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    if (moduleSpecifier.startsWith('.') && moduleSpecifier.endsWith('/index')) {
      const optimizedPath = moduleSpecifier.replace(/\/index$/, '');
      const originalImport = importDecl.getText();

      importDecl.setModuleSpecifier(optimizedPath);

      changes.push({
        type: 'optimized_path',
        originalImport,
        newImport: importDecl.getText(),
        reason: 'Removed /index suffix from import path',
      });
    }
  }
};

const consolidateImportsFromSameModule = async (
  sourceFile: SourceFile,
  changes: ImportOptimizationChange[]
): Promise<void> => {
  const importDeclarations = sourceFile.getImportDeclarations();
  const importGroups = new Map<string, ImportDeclaration[]>();

  // Group imports by module specifier
  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    if (!importGroups.has(moduleSpecifier)) {
      importGroups.set(moduleSpecifier, []);
    }
    importGroups.get(moduleSpecifier)!.push(importDecl);
  }

  // Consolidate groups with multiple imports
  for (const [moduleSpecifier, imports] of importGroups) {
    if (imports.length > 1) {
      const allNamedImports: string[] = [];
      const typeImports: string[] = [];
      const valueImports: string[] = [];
      let defaultImport: string | undefined;
      let namespaceImport: string | undefined;

      // Collect all imports from the same module
      for (const importDecl of imports) {
        // Default import
        const defaultImp = importDecl.getDefaultImport();
        if (defaultImp && !defaultImport) {
          defaultImport = defaultImp.getText();
        }

        // Namespace import
        const namespaceImp = importDecl.getNamespaceImport();
        if (namespaceImp && !namespaceImport) {
          namespaceImport = namespaceImp.getText();
        }

        // Named imports
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
          const importName = namedImport.getName();
          if (!allNamedImports.includes(importName)) {
            allNamedImports.push(importName);
            
            // Check if it's a type import
            if (importDecl.isTypeOnly() || isTypeOnlyImport(namedImport)) {
              typeImports.push(importName);
            } else {
              valueImports.push(importName);
            }
          }
        }
      }

      // Remove all imports except the first one
      const firstImport = imports[0];
      const originalImports = imports.map(imp => imp.getText()).join('\n');
      
      for (let i = 1; i < imports.length; i++) {
        const importToRemove = imports[i];
        if (importToRemove) {
          importToRemove.remove();
        }
      }

      // Reconstruct the consolidated import
      let consolidatedImport = '';
      const importParts: string[] = [];

      if (defaultImport) {
        importParts.push(defaultImport);
      }

      if (namespaceImport) {
        importParts.push(namespaceImport);
      }

      if (valueImports.length > 0) {
        importParts.push(`{ ${valueImports.join(', ')} }`);
      }

      if (importParts.length > 0) {
        consolidatedImport = `import ${importParts.join(', ')} from '${moduleSpecifier}';`;
      }

      // Add type import if needed
      let typeImportStatement = '';
      if (typeImports.length > 0) {
        typeImportStatement = `import type { ${typeImports.join(', ')} } from '${moduleSpecifier}';`;
      }

      // Replace the first import with consolidated version
      if (consolidatedImport || typeImportStatement) {
        const newImportText = [typeImportStatement, consolidatedImport]
          .filter(Boolean)
          .join('\n');
        
        if (firstImport) {
          firstImport.replaceWithText(newImportText);
        }

        changes.push({
          type: 'consolidated',
          originalImport: originalImports,
          newImport: newImportText,
          reason: `Consolidated ${imports.length} imports from '${moduleSpecifier}'`,
        });
      }
    }
  }
};

const separateTypeAndValueImports = async (
  sourceFile: SourceFile,
  changes: ImportOptimizationChange[]
): Promise<void> => {
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    if (importDecl.isTypeOnly()) {
      continue; // Already a type-only import
    }

    const namedImports = importDecl.getNamedImports();
    const typeImports: string[] = [];
    const valueImports: string[] = [];

    for (const namedImport of namedImports) {
      const importName = namedImport.getName();
      
      if (isTypeIdentifier(sourceFile, importName)) {
        typeImports.push(importName);
      } else {
        valueImports.push(importName);
      }
    }

    // Only separate if we have both types and values
    if (typeImports.length > 0 && valueImports.length > 0) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const originalImport = importDecl.getText();
      
      // Build new import statements
      const valueImportText = `import { ${valueImports.join(', ')} } from '${moduleSpecifier}';`;
      const typeImportText = `import type { ${typeImports.join(', ')} } from '${moduleSpecifier}';`;
      
      const newImportText = [typeImportText, valueImportText].join('\n');
      
      importDecl.replaceWithText(newImportText);

      changes.push({
        type: 'separated',
        originalImport,
        newImport: newImportText,
        reason: `Separated ${typeImports.length} type imports from ${valueImports.length} value imports`,
      });
    }
  }
};

const isIdentifierUsed = (sourceFile: SourceFile, identifier: string, importDecl: ImportDeclaration): boolean => {
  const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
  
  return identifiers.some(id => {
    // Skip the identifier in the import declaration itself
    if (id.getAncestors().includes(importDecl)) {
      return false;
    }
    
    return id.getText() === identifier;
  });
};

const isTypeOnlyImport = (namedImport: any): boolean => {
  // Check if the named import has a type modifier
  return namedImport.isTypeOnly?.() || false;
};

const isTypeIdentifier = (sourceFile: SourceFile, identifier: string): boolean => {
  const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
  
  for (const id of identifiers) {
    if (id.getText() === identifier) {
      const parent = id.getParent();
      
      // Check if used in type contexts
      if (Node.isTypeReference(parent) || 
          Node.isTypeQuery(parent) ||
          Node.isInterfaceDeclaration(parent) ||
          Node.isTypeAliasDeclaration(parent)) {
        return true;
      }
      
      // Check if used as a type in variable declarations, function parameters, etc.
      if (Node.isVariableDeclaration(parent) || 
          Node.isParameterDeclaration(parent) ||
          Node.isPropertySignature(parent) ||
          Node.isMethodSignature(parent)) {
        const typeNode = (parent as any).getTypeNode?.();
        if (typeNode && typeNode.getDescendantsOfKind(SyntaxKind.Identifier).some((typeId: any) => typeId.getText() === identifier)) {
          return true;
        }
      }
    }
  }
  
  return false;
};