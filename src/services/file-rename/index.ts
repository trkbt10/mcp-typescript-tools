import { Project, SourceFile, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { FileRenameOptions, FileRenameResult } from '../../types';

export const renameFileOrFolder = async (options: FileRenameOptions): Promise<FileRenameResult> => {
  const { sourcePath, destinationPath, updateImports = true } = options;
  let project: Project | undefined;

  try {
    // Check if source exists
    const sourceStats = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStats) {
      return {
        success: false,
        error: `Source path not found: ${sourcePath}`,
      };
    }

    const isDirectory = sourceStats.isDirectory();
    
    // Check if destination already exists
    const destStats = await fs.stat(destinationPath).catch(() => null);
    if (destStats) {
      return {
        success: false,
        error: `Destination already exists: ${destinationPath}`,
      };
    }

    // Try to find tsconfig.json
    const tsconfigPath = await findTsConfig(sourcePath);
    
    const projectOptions: ConstructorParameters<typeof Project>[0] = {
      useInMemoryFileSystem: false,
    };

    if (tsconfigPath) {
      projectOptions.tsConfigFilePath = tsconfigPath;
    }

    project = new Project(projectOptions);

    if (tsconfigPath) {
      // Ensure files from tsconfig are loaded; skip node_modules per config excludes
      if (project.getSourceFiles().length === 0) {
        project.addSourceFilesFromTsConfig(tsconfigPath);
      }
    } else {
      // Fallback glob when no tsconfig is found; exclude heavy/common build dirs
      project.addSourceFilesAtPaths([
        '**/*.ts',
        '**/*.tsx',
        '!**/node_modules/**',
        '!**/dist/**',
        '!**/build/**',
        '!**/.next/**',
        '!**/.turbo/**',
        '!**/out/**',
      ]);
    }

    const updatedFiles = new Set<string>();
    const affectedImports: Array<{ file: string; oldImport: string; newImport: string }> = [];

    if (updateImports) {
      if (isDirectory) {
        // Handle directory rename
        await updateImportsForDirectory(project, sourcePath, destinationPath, updatedFiles, affectedImports);
      } else {
        // Handle file rename
        await updateImportsForFile(project, sourcePath, destinationPath, updatedFiles, affectedImports);
      }
    }

    // Save all changes before renaming
    await project.save();
    
    // Give the file system a moment to sync
    await new Promise(resolve => setTimeout(resolve, 50));

    // Perform the actual file/folder move
    await fs.rename(sourcePath, destinationPath);

    return {
      success: true,
      updatedFiles: Array.from(updatedFiles),
      affectedImports,
      isDirectory,
    };
  } catch (error) {
    return {
      success: false,
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

const updateImportsForFile = async (
  project: Project,
  oldPath: string,
  newPath: string,
  updatedFiles: Set<string>,
  affectedImports: Array<{ file: string; oldImport: string; newImport: string }>
) => {
  const sourceFiles = project.getSourceFiles();
  const oldAbsPath = path.resolve(oldPath);
  const newAbsPath = path.resolve(newPath);
  

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    let fileModified = false;

    // Update import declarations
    sourceFile.getImportDeclarations().forEach(importDecl => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const resolvedPath = resolveImportPath(filePath, moduleSpecifier);
      
      if (resolvedPath === oldAbsPath || resolvedPath.startsWith(oldAbsPath + '/')) {
        const newImportPath = calculateNewImportPath(filePath, oldAbsPath, newAbsPath, moduleSpecifier);
        affectedImports.push({
          file: filePath,
          oldImport: moduleSpecifier,
          newImport: newImportPath,
        });
        importDecl.setModuleSpecifier(newImportPath);
        fileModified = true;
      }
    });

    // Update export declarations
    sourceFile.getExportDeclarations().forEach(exportDecl => {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (moduleSpecifier) {
        const resolvedPath = resolveImportPath(filePath, moduleSpecifier);
        
        if (resolvedPath === oldAbsPath || resolvedPath.startsWith(oldAbsPath + '/')) {
          const newImportPath = calculateNewImportPath(filePath, oldAbsPath, newAbsPath, moduleSpecifier);
          affectedImports.push({
            file: filePath,
            oldImport: moduleSpecifier,
            newImport: newImportPath,
          });
          exportDecl.setModuleSpecifier(newImportPath);
          fileModified = true;
        }
      }
    });

    // Update dynamic imports
    const callExprs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    callExprs.forEach(callExpr => {
      const expression = callExpr.getExpression();
      if (expression.getText() === 'import') {
        const args = callExpr.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          const moduleSpecifier = args[0].getLiteralValue();
          const resolvedPath = resolveImportPath(filePath, moduleSpecifier);
          
          if (resolvedPath === oldAbsPath || resolvedPath.startsWith(oldAbsPath + '/')) {
            const newImportPath = calculateNewImportPath(filePath, oldAbsPath, newAbsPath, moduleSpecifier);
            affectedImports.push({
              file: filePath,
              oldImport: moduleSpecifier,
              newImport: newImportPath,
            });
            // Use setLiteralValue instead of replaceWithText to preserve quotes
            args[0].setLiteralValue(newImportPath);
            fileModified = true;
          }
        }
      }
    });

    if (fileModified) {
      updatedFiles.add(filePath);
    }
  }
};

const updateImportsForDirectory = async (
  project: Project,
  oldPath: string,
  newPath: string,
  updatedFiles: Set<string>,
  affectedImports: Array<{ file: string; oldImport: string; newImport: string }>
) => {
  const sourceFiles = project.getSourceFiles();
  const oldAbsPath = path.resolve(oldPath);
  const newAbsPath = path.resolve(newPath);
  

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    let fileModified = false;
    const newFilePath = filePath.startsWith(oldAbsPath)
      ? filePath.replace(oldAbsPath, newAbsPath)
      : undefined;

    // Update import declarations
    sourceFile.getImportDeclarations().forEach(importDecl => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const resolvedPath = resolveImportPath(filePath, moduleSpecifier);
      
      if (resolvedPath.startsWith(oldAbsPath)) {
        const newImportPath = calculateNewImportPath(
          filePath,
          oldAbsPath,
          newAbsPath,
          moduleSpecifier,
          newFilePath
        );
        affectedImports.push({
          file: filePath,
          oldImport: moduleSpecifier,
          newImport: newImportPath,
        });
        importDecl.setModuleSpecifier(newImportPath);
        fileModified = true;
      }
    });

    // Update export declarations
    sourceFile.getExportDeclarations().forEach(exportDecl => {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (moduleSpecifier) {
        const resolvedPath = resolveImportPath(filePath, moduleSpecifier);
        
        if (resolvedPath.startsWith(oldAbsPath)) {
          const newImportPath = calculateNewImportPath(
            filePath,
            oldAbsPath,
            newAbsPath,
            moduleSpecifier,
            newFilePath
          );
          affectedImports.push({
            file: filePath,
            oldImport: moduleSpecifier,
            newImport: newImportPath,
          });
          exportDecl.setModuleSpecifier(newImportPath);
          fileModified = true;
        }
      }
    });

    // Update dynamic imports
    const callExprs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    callExprs.forEach(callExpr => {
      const expression = callExpr.getExpression();
      if (expression.getText() === 'import') {
        const args = callExpr.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          const moduleSpecifier = args[0].getLiteralValue();
          const resolvedPath = resolveImportPath(filePath, moduleSpecifier);
          
          if (resolvedPath.startsWith(oldAbsPath)) {
            const newImportPath = calculateNewImportPath(
              filePath,
              oldAbsPath,
              newAbsPath,
              moduleSpecifier,
              newFilePath
            );
            affectedImports.push({
              file: filePath,
              oldImport: moduleSpecifier,
              newImport: newImportPath,
            });
            args[0].setLiteralValue(newImportPath);
            fileModified = true;
          }
        }
      }
    });

    if (fileModified) {
      updatedFiles.add(filePath);
    }
  }
};

const resolveImportPath = (fromFile: string, importPath: string): string => {
  if (!importPath.startsWith('.')) {
    return importPath; // node_modules import
  }

  const fromDir = path.dirname(fromFile);
  let resolvedPath = path.resolve(fromDir, importPath);

  // Try with common extensions if path doesn't exist
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  
  for (const ext of extensions) {
    try {
      const testPath = resolvedPath + ext;
      const stats = require('fs').statSync(testPath);
      if (stats.isFile() || stats.isDirectory()) {
        return testPath;
      }
    } catch {
      // Continue trying
    }
  }

  return resolvedPath;
};

const calculateNewImportPath = (
  fromFile: string,
  oldAbsPath: string,
  newAbsPath: string,
  originalImport: string,
  newFromFilePath?: string
): string => {
  if (!originalImport.startsWith('.')) {
    return originalImport; // node_modules import
  }

  const fromDir = path.dirname(newFromFilePath ?? fromFile);
  
  // Get the resolved path with extension
  const resolvedWithExt = resolveImportPath(fromFile, originalImport);
  
  // Replace the old absolute path with the new one
  const resolvedNewPath = resolvedWithExt.replace(oldAbsPath, newAbsPath);
  
  // Calculate relative path from the importing file
  let relativePath = path.relative(fromDir, resolvedNewPath);
  
  // Ensure it starts with ./ or ../
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }
  
  // Convert to forward slashes for consistency
  relativePath = relativePath.replace(/\\/g, '/');
  
  // Remove extensions if they weren't in the original import
  const hasExtension = /\.(ts|tsx|js|jsx)$/.test(originalImport);
  if (!hasExtension) {
    relativePath = relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
  }
  
  // Remove /index suffix if it wasn't in the original import
  if (!originalImport.endsWith('/index')) {
    relativePath = relativePath.replace(/\/index$/, '');
  }
  
  return relativePath;
};

const findTsConfig = async (startPath: string): Promise<string | undefined> => {
  let currentPath = path.resolve(startPath);
  const isFile = (await fs.stat(currentPath).catch(() => null))?.isFile();
  
  if (isFile) {
    currentPath = path.dirname(currentPath);
  }
  
  while (currentPath !== path.dirname(currentPath)) {
    const tsconfigPath = path.join(currentPath, 'tsconfig.json');
    try {
      await fs.access(tsconfigPath);
      return tsconfigPath;
    } catch {
      // Continue searching up
    }
    currentPath = path.dirname(currentPath);
  }
  
  return undefined;
};
