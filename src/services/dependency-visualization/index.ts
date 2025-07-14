import { Project, SourceFile } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import type {
  DependencyVisualizationOptions,
  DependencyVisualizationResult,
  DependencyNode,
  CircularDependency,
} from '../../types';
import { cleanupProject } from '../../utils/project-cleanup';

export const visualizeDependencies = async (
  options: DependencyVisualizationOptions
): Promise<DependencyVisualizationResult> => {
  const {
    rootPath,
    format = 'mermaid',
    includeNodeModules = false,
    maxDepth = 10,
    detectCircular = true,
  } = options;
  let project: Project | undefined;

  try {
    project = new Project({
      useInMemoryFileSystem: false,
    });

    // Find all TypeScript files
    const pattern = includeNodeModules 
      ? '**/*.{ts,tsx}' 
      : '**/*.{ts,tsx}';
    
    const ignore = includeNodeModules 
      ? ['**/dist/**', '**/*.d.ts']
      : ['**/node_modules/**', '**/dist/**', '**/*.d.ts'];

    const files = await glob(pattern, {
      cwd: rootPath,
      ignore,
      absolute: true,
    });

    // Add files to project
    for (const file of files) {
      try {
        project.addSourceFileAtPath(file);
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Build dependency graph
    const nodes = await buildDependencyGraph(project, rootPath, maxDepth);
    
    // Detect circular dependencies
    let circularDependencies: CircularDependency[] = [];
    if (detectCircular) {
      circularDependencies = detectCircularDependencies(nodes);
    }

    // Generate output based on format
    const content = generateVisualization(nodes, circularDependencies, format);

    const statistics = {
      totalFiles: nodes.filter(n => n.type === 'file').length,
      totalImports: nodes.reduce((sum, n) => sum + n.imports.length, 0),
      maxDepth: calculateMaxDepth(nodes, rootPath),
      circularCount: circularDependencies.length,
    };

    return {
      format,
      content,
      nodes,
      circularDependencies,
      statistics,
    };
  } catch (error) {
    return {
      format,
      content: '',
      nodes: [],
      statistics: {
        totalFiles: 0,
        totalImports: 0,
        maxDepth: 0,
        circularCount: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (project) {
      cleanupProject(project);
    }
  }
};

const buildDependencyGraph = async (
  project: Project,
  rootPath: string,
  maxDepth: number
): Promise<DependencyNode[]> => {
  const nodes: DependencyNode[] = [];
  const sourceFiles = project.getSourceFiles();

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(rootPath, filePath);
    
    // Skip if beyond max depth
    const depth = relativePath.split(path.sep).length;
    if (depth > maxDepth) {
      continue;
    }

    const node = await createDependencyNode(sourceFile, rootPath);
    nodes.push(node);
  }

  return nodes;
};

const createDependencyNode = async (
  sourceFile: SourceFile,
  rootPath: string
): Promise<DependencyNode> => {
  const filePath = sourceFile.getFilePath();
  const relativePath = path.relative(rootPath, filePath);
  
  // Get imports
  const imports: string[] = [];
  const importDeclarations = sourceFile.getImportDeclarations();
  
  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    
    if (moduleSpecifier.startsWith('.')) {
      // Resolve relative import
      const resolvedPath = path.resolve(path.dirname(filePath), moduleSpecifier);
      const relativeImport = path.relative(rootPath, resolvedPath);
      imports.push(relativeImport);
    } else {
      // External import
      imports.push(moduleSpecifier);
    }
  }

  // Get exports
  const exports: string[] = [];
  const exportDeclarations = sourceFile.getExportDeclarations();
  const exportedDeclarations = sourceFile.getExportedDeclarations();
  
  // Named exports
  for (const [name] of exportedDeclarations) {
    exports.push(name);
  }
  
  // Re-exports
  for (const exportDecl of exportDeclarations) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (moduleSpecifier) {
      exports.push(`re-export: ${moduleSpecifier}`);
    }
  }

  // Get file size
  let size: number | undefined;
  try {
    const stats = await fs.stat(filePath);
    size = stats.size;
  } catch {
    // Ignore size calculation errors
  }

  return {
    id: relativePath,
    filePath,
    type: 'file',
    imports,
    exports,
    size,
  };
};

const detectCircularDependencies = (nodes: DependencyNode[]): CircularDependency[] => {
  const circularDeps: CircularDependency[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const dfs = (nodeId: string, path: string[]): void => {
    if (recursionStack.has(nodeId)) {
      // Found circular dependency
      const cycleStart = path.indexOf(nodeId);
      const cycle = path.slice(cycleStart).concat(nodeId);
      
      circularDeps.push({
        cycle,
        severity: cycle.length > 3 ? 'error' : 'warning',
        suggestion: generateCircularSuggestion(cycle),
      });
      return;
    }

    if (visited.has(nodeId)) {
      return;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);
    
    const node = nodeMap.get(nodeId);
    if (node) {
      for (const importPath of node.imports) {
        if (!importPath.startsWith('.')) {
          continue; // Skip external imports
        }
        
        dfs(importPath, [...path, nodeId]);
      }
    }
    
    recursionStack.delete(nodeId);
  };

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return circularDeps;
};

const generateCircularSuggestion = (cycle: string[]): string => {
  if (cycle.length === 2) {
    return 'Consider moving shared functionality to a separate module';
  } else if (cycle.length === 3) {
    return 'Try dependency injection or create an intermediate interface';
  } else {
    return 'Consider restructuring modules or using dependency injection';
  }
};

const calculateMaxDepth = (nodes: DependencyNode[], rootPath: string): number => {
  let maxDepth = 0;
  
  for (const node of nodes) {
    const relativePath = path.relative(rootPath, node.filePath);
    const depth = relativePath.split(path.sep).length;
    maxDepth = Math.max(maxDepth, depth);
  }
  
  return maxDepth;
};

const generateVisualization = (
  nodes: DependencyNode[],
  circularDeps: CircularDependency[],
  format: string
): string => {
  switch (format) {
    case 'mermaid':
      return generateMermaidDiagram(nodes, circularDeps);
    case 'dot':
      return generateDotDiagram(nodes, circularDeps);
    case 'json':
      return JSON.stringify({ nodes, circularDependencies: circularDeps }, null, 2);
    default:
      return generateMermaidDiagram(nodes, circularDeps);
  }
};

const generateMermaidDiagram = (
  nodes: DependencyNode[],
  circularDeps: CircularDependency[]
): string => {
  let diagram = 'graph TD\n';
  
  // Add nodes
  for (const node of nodes) {
    const nodeId = sanitizeId(node.id);
    const label = path.basename(node.filePath, path.extname(node.filePath));
    diagram += `  ${nodeId}[${label}]\n`;
  }
  
  // Add dependencies
  for (const node of nodes) {
    const nodeId = sanitizeId(node.id);
    for (const importPath of node.imports) {
      if (importPath.startsWith('.')) {
        const importId = sanitizeId(importPath);
        diagram += `  ${nodeId} --> ${importId}\n`;
      }
    }
  }
  
  // Highlight circular dependencies
  const circularNodes = new Set(circularDeps.flatMap(dep => dep.cycle));
  for (const nodeId of circularNodes) {
    const sanitizedId = sanitizeId(nodeId);
    diagram += `  ${sanitizedId} -.-> ${sanitizedId}\n`;
    diagram += `  classDef circular fill:#ffcccc\n`;
    diagram += `  class ${sanitizedId} circular\n`;
  }
  
  return diagram;
};

const generateDotDiagram = (
  nodes: DependencyNode[],
  circularDeps: CircularDependency[]
): string => {
  let diagram = 'digraph Dependencies {\n';
  diagram += '  rankdir=LR;\n';
  diagram += '  node [shape=box];\n';
  
  // Add nodes
  for (const node of nodes) {
    const nodeId = sanitizeId(node.id);
    const label = path.basename(node.filePath, path.extname(node.filePath));
    diagram += `  "${nodeId}" [label="${label}"];\n`;
  }
  
  // Add dependencies
  for (const node of nodes) {
    const nodeId = sanitizeId(node.id);
    for (const importPath of node.imports) {
      if (importPath.startsWith('.')) {
        const importId = sanitizeId(importPath);
        diagram += `  "${nodeId}" -> "${importId}";\n`;
      }
    }
  }
  
  // Highlight circular dependencies
  const circularNodes = new Set(circularDeps.flatMap(dep => dep.cycle));
  for (const nodeId of circularNodes) {
    const sanitizedId = sanitizeId(nodeId);
    diagram += `  "${sanitizedId}" [color=red, style=filled, fillcolor=lightcoral];\n`;
  }
  
  diagram += '}';
  return diagram;
};

const sanitizeId = (id: string): string => {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
};