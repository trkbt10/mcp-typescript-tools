import { Project, SourceFile } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { FileMoveOptions, FileMoveResult } from '../../types';
import { cleanupProject } from '../../utils/project-cleanup';

export const moveTypeScriptFile = async (options: FileMoveOptions): Promise<FileMoveResult> => {
  const { source, destination, updateImports = true } = options;
  let project: Project | undefined;

  try {
    const absoluteSource = path.resolve(source);
    const absoluteDestination = path.resolve(destination);

    // Find tsconfig.json starting from the source file directory
    const sourceDir = path.dirname(absoluteSource);
    const tsConfigPath = await findTsConfig(sourceDir);

    project = new Project({
      tsConfigFilePath: tsConfigPath,
      useInMemoryFileSystem: false,
    });

    // Add source file if not already in project
    const sourceFile = project.getSourceFile(absoluteSource) || project.addSourceFileAtPath(absoluteSource);
    
    if (!sourceFile) {
      return {
        success: false,
        error: `Source file not found: ${source}`,
      };
    }

    if (updateImports) {
      // Add all relevant TypeScript files to the project
      await addProjectFiles(project, path.dirname(tsConfigPath || process.cwd()));
      
      const updatedFiles = await updateImportPaths(project, absoluteSource, absoluteDestination);
      
      await fs.mkdir(path.dirname(absoluteDestination), { recursive: true });
      await sourceFile.move(absoluteDestination);
      
      await project.save();

      return {
        success: true,
        updatedFiles,
      };
    } else {
      await fs.mkdir(path.dirname(absoluteDestination), { recursive: true });
      await fs.rename(absoluteSource, absoluteDestination);

      return {
        success: true,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Clean up project resources
    if (project) {
      cleanupProject(project);
    }
  }
};

const findTsConfig = async (startDir: string): Promise<string | undefined> => {
  let currentDir = startDir;
  
  while (currentDir !== path.dirname(currentDir)) {
    const tsConfigPath = path.join(currentDir, 'tsconfig.json');
    try {
      await fs.access(tsConfigPath);
      return tsConfigPath;
    } catch {
      currentDir = path.dirname(currentDir);
    }
  }
  
  return undefined;
};

const addProjectFiles = async (project: Project, projectDir: string): Promise<void> => {
  const glob = require('glob');
  
  try {
    const tsFiles = glob.sync('**/*.{ts,tsx}', {
      cwd: projectDir,
      ignore: ['node_modules/**', 'dist/**', '**/*.d.ts'],
      absolute: true,
    });

    for (const filePath of tsFiles) {
      if (!project.getSourceFile(filePath)) {
        try {
          project.addSourceFileAtPath(filePath);
        } catch {
          // Ignore errors when adding files
        }
      }
    }
  } catch {
    // Fallback: don't add files if glob fails
  }
};

const updateImportPaths = async (
  project: Project,
  oldPath: string,
  newPath: string
): Promise<string[]> => {
  const updatedFiles: string[] = [];
  
  // Get all source files or add them if not already included
  const sourceFiles = project.getSourceFiles();
  
  // Also scan for TypeScript files in the project directory if needed
  const compilerOptions = project.getCompilerOptions();
  const configFilePath = compilerOptions.configFilePath;
  const projectDir = path.dirname(typeof configFilePath === 'string' ? configFilePath : process.cwd());
  
  for (const file of sourceFiles) {
    let hasChanges = false;

    file.getImportDeclarations().forEach((importDecl) => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      
      if (moduleSpecifier.startsWith('.')) {
        const importerDir = path.dirname(file.getFilePath());
        const resolvedPath = path.resolve(importerDir, moduleSpecifier);
        
        const possiblePaths = [
          resolvedPath,
          resolvedPath + '.ts',
          resolvedPath + '.tsx',
          path.join(resolvedPath, 'index.ts'),
          path.join(resolvedPath, 'index.tsx'),
        ];

        if (possiblePaths.some(p => p === oldPath)) {
          const newRelativePath = createOptimalImportPath(importerDir, newPath);
          importDecl.setModuleSpecifier(newRelativePath);
          hasChanges = true;
        }
      }
    });

    file.getExportDeclarations().forEach((exportDecl) => {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      
      if (moduleSpecifier && moduleSpecifier.startsWith('.')) {
        const exporterDir = path.dirname(file.getFilePath());
        const resolvedPath = path.resolve(exporterDir, moduleSpecifier);
        
        const possiblePaths = [
          resolvedPath,
          resolvedPath + '.ts',
          resolvedPath + '.tsx',
          path.join(resolvedPath, 'index.ts'),
          path.join(resolvedPath, 'index.tsx'),
        ];

        if (possiblePaths.some(p => p === oldPath)) {
          const newRelativePath = createOptimalImportPath(exporterDir, newPath);
          exportDecl.setModuleSpecifier(newRelativePath);
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      updatedFiles.push(file.getFilePath());
    }
  }

  return updatedFiles;
};

const createOptimalImportPath = (fromDir: string, toPath: string): string => {
  const fs = require('fs');
  
  // Remove file extension from target path
  const targetPath = toPath.replace(/\.(ts|tsx)$/, '');
  
  // Check if target is an index file
  const isIndexFile = path.basename(targetPath) === 'index';
  
  if (isIndexFile) {
    // If it's an index file, reference the directory instead
    const targetDir = path.dirname(targetPath);
    const relativePath = path.relative(fromDir, targetDir);
    const normalizedPath = relativePath.startsWith('.') ? relativePath : './' + relativePath;
    return normalizedPath.replace(/\\/g, '/');
  } else {
    // Check if there's an index file in the target directory that could make the path shorter
    const targetDir = path.dirname(targetPath);
    const targetFileName = path.basename(targetPath);
    
    // Check if there's an index file in the same directory
    const indexFiles = [
      path.join(targetDir, 'index.ts'),
      path.join(targetDir, 'index.tsx'),
    ];
    
    const hasIndexFile = indexFiles.some(indexPath => {
      try {
        return fs.existsSync(indexPath);
      } catch {
        return false;
      }
    });
    
    if (hasIndexFile) {
      // If there's an index file, we might be able to use directory reference
      // But only if the target file is NOT the index file itself
      const relativePath = path.relative(fromDir, targetPath);
      const normalizedPath = relativePath.startsWith('.') ? relativePath : './' + relativePath;
      return normalizedPath.replace(/\\/g, '/');
    } else {
      // No index file, use full path
      const relativePath = path.relative(fromDir, targetPath);
      const normalizedPath = relativePath.startsWith('.') ? relativePath : './' + relativePath;
      return normalizedPath.replace(/\\/g, '/');
    }
  }
};