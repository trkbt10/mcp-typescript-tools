import * as fs from 'fs';
import * as path from 'path';
import type { DeletableAnalysisResult } from '../../types';

export const generateTestFile = async (
  analysis: DeletableAnalysisResult
): Promise<string | undefined> => {
  try {
    const { filePath, isDeletable, references, exports } = analysis;
    const fileName = path.basename(filePath, path.extname(filePath));
    const fileDir = path.dirname(filePath);
    const testFilePath = path.join(fileDir, `${fileName}.spec.ts`);

    const testContent = generateTestContent(fileName, isDeletable, references, exports, filePath);
    
    fs.writeFileSync(testFilePath, testContent);
    return testFilePath;
  } catch (error) {
    console.error('Failed to generate test file:', error);
    return undefined;
  }
};

export const createMockStructure = async (
  analysis: DeletableAnalysisResult
): Promise<string[]> => {
  const { filePath, references } = analysis;
  const mockFiles: string[] = [];
  
  try {
    const fileDir = path.dirname(filePath);
    const mocksDir = path.join(fileDir, '__mocks__');
    
    // Create __mocks__ directory if it doesn't exist
    if (!fs.existsSync(mocksDir)) {
      fs.mkdirSync(mocksDir, { recursive: true });
    }

    // Create mock files for each referencing file
    const referencingFiles = new Set(references.map(ref => ref.file));
    
    for (const refFile of referencingFiles) {
      const refFileName = path.basename(refFile, path.extname(refFile));
      const mockFilePath = path.join(mocksDir, `${refFileName}.mock.ts`);
      
      const mockContent = generateMockContent(refFile, references.filter(ref => ref.file === refFile));
      
      fs.writeFileSync(mockFilePath, mockContent);
      mockFiles.push(mockFilePath);
    }

    // Create a package mock if there are external-looking references
    const hasExternalLookingRefs = references.some(ref => 
      ref.type === 'dynamic_import' || ref.importedNames.includes('*')
    );
    
    if (hasExternalLookingRefs) {
      const packageMockPath = path.join(mocksDir, 'package.mock.ts');
      const packageMockContent = generatePackageMockContent(analysis);
      
      fs.writeFileSync(packageMockPath, packageMockContent);
      mockFiles.push(packageMockPath);
    }

    return mockFiles;
  } catch (error) {
    console.error('Failed to create mock structure:', error);
    return [];
  }
};

const generateTestContent = (
  fileName: string,
  isDeletable: boolean,
  references: DeletableAnalysisResult['references'],
  exports: DeletableAnalysisResult['exports'],
  originalFilePath: string
): string => {
  const relativeImportPath = `./${fileName}`;
  
  return `import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
${generateImportStatements(exports, relativeImportPath)}

describe('${fileName} - Deletion Safety Test', () => {
  describe('File Analysis', () => {
    it('should be ${isDeletable ? 'safe' : 'unsafe'} to delete', () => {
      // Analysis Result: ${isDeletable ? 'No references found' : `${references.length} reference(s) found`}
      expect(${isDeletable}).toBe(true);
    });

    ${!isDeletable ? generateReferenceTests(references) : ''}
  });

  describe('Export Validation', () => {
    ${generateExportTests(exports, fileName)}
  });

  ${generateUsageTests(references, exports)}
});

/**
 * Test Metadata:
 * - Original file: ${originalFilePath}
 * - Can be deleted: ${isDeletable}
 * - References found: ${references.length}
 * - Exports: ${exports.length}
 * 
 * References:
${references.map(ref => ` * - ${path.basename(ref.file)}:${ref.line} (${ref.type})`).join('\n')}
 */`;
};

const generateImportStatements = (
  exports: DeletableAnalysisResult['exports'],
  importPath: string
): string => {
  const statements: string[] = [];
  
  // Separate type and value imports
  const typeExports = exports.filter(exp => exp.isTypeOnly);
  const valueExports = exports.filter(exp => !exp.isTypeOnly);
  
  if (typeExports.length > 0) {
    const typeNames = typeExports.filter(exp => exp.name !== 'default').map(exp => exp.name);
    if (typeNames.length > 0) {
      statements.push(`import type { ${typeNames.join(', ')} } from '${importPath}';`);
    }
  }
  
  if (valueExports.length > 0) {
    const valueNames = valueExports.filter(exp => exp.name !== 'default').map(exp => exp.name);
    const hasDefault = valueExports.some(exp => exp.name === 'default');
    
    if (hasDefault && valueNames.length > 0) {
      statements.push(`import defaultExport, { ${valueNames.join(', ')} } from '${importPath}';`);
    } else if (hasDefault) {
      statements.push(`import defaultExport from '${importPath}';`);
    } else if (valueNames.length > 0) {
      statements.push(`import { ${valueNames.join(', ')} } from '${importPath}';`);
    }
  }
  
  return statements.join('\n');
};

const generateReferenceTests = (references: DeletableAnalysisResult['references']): string => {
  const refsByFile = new Map<string, typeof references>();
  
  references.forEach(ref => {
    const fileName = path.basename(ref.file);
    if (!refsByFile.has(fileName)) {
      refsByFile.set(fileName, []);
    }
    refsByFile.get(fileName)!.push(ref);
  });

  const tests: string[] = [];
  
  refsByFile.forEach((refs, fileName) => {
    tests.push(`
    it('should handle references in ${fileName}', () => {
      // Found ${refs.length} reference(s) in this file
      ${refs.map(ref => `
      // Line ${ref.line}: ${ref.text.replace(/\n/g, '\\n')}
      // Type: ${ref.type}, Imports: [${ref.importedNames.join(', ')}]`).join('')}
      expect(true).toBe(true); // TODO: Add specific validation
    });`);
  });
  
  return tests.join('\n');
};

const generateExportTests = (
  exports: DeletableAnalysisResult['exports'],
  fileName: string
): string => {
  if (exports.length === 0) {
    return `
    it('should have no exports', () => {
      expect(true).toBe(true); // File has no exports
    });`;
  }

  const tests: string[] = [];
  
  exports.forEach(exp => {
    if (exp.name === 'default') {
      tests.push(`
    it('should export default value', () => {
      expect(defaultExport).toBeDefined();
    });`);
    } else {
      tests.push(`
    it('should export ${exp.name} (${exp.type})${exp.isTypeOnly ? ' - type only' : ''}', () => {
      expect(${exp.name}).toBeDefined();
    });`);
    }
  });
  
  return tests.join('\n');
};

const generateUsageTests = (
  references: DeletableAnalysisResult['references'],
  exports: DeletableAnalysisResult['exports']
): string => {
  if (references.length === 0) {
    return `
  describe('Usage Simulation', () => {
    it('should work when used as intended', () => {
      // No references found - this file appears to be unused
      expect(true).toBe(true);
    });
  });`;
  }

  const usageTests: string[] = [];
  
  // Generate tests based on how the file is being used
  const importTypes = new Set(references.map(ref => ref.type));
  
  if (importTypes.has('import')) {
    usageTests.push(`
    it('should work with direct imports', () => {
      // Simulate direct import usage
      ${exports.filter(exp => !exp.isTypeOnly).map(exp => {
        if (exp.type === 'function') {
          return `expect(typeof ${exp.name === 'default' ? 'defaultExport' : exp.name}).toBe('function');`;
        } else if (exp.type === 'class') {
          return `expect(typeof ${exp.name === 'default' ? 'defaultExport' : exp.name}).toBe('function'); // class constructor`;
        } else {
          return `expect(${exp.name === 'default' ? 'defaultExport' : exp.name}).toBeDefined();`;
        }
      }).join('\n      ')}
    });`);
  }
  
  if (importTypes.has('export')) {
    usageTests.push(`
    it('should work with re-exports', () => {
      // This file is being re-exported by other modules
      expect(true).toBe(true); // TODO: Add re-export validation
    });`);
  }
  
  if (importTypes.has('dynamic_import')) {
    usageTests.push(`
    it('should work with dynamic imports', () => {
      // This file is being dynamically imported
      expect(true).toBe(true); // TODO: Add dynamic import validation
    });`);
  }

  return `
  describe('Usage Simulation', () => {${usageTests.join('\n')}
  });`;
};

const generateMockContent = (
  referencingFile: string,
  fileReferences: DeletableAnalysisResult['references']
): string => {
  const fileName = path.basename(referencingFile, path.extname(referencingFile));
  
  return `/**
 * Mock for ${fileName}
 * 
 * This mock simulates the usage patterns found in the original file.
 * References found: ${fileReferences.length}
 */

${fileReferences.map(ref => `
// Mock for: ${ref.text}
// Type: ${ref.type}, Line: ${ref.line}
export const mock${ref.type.charAt(0).toUpperCase() + ref.type.slice(1)}${ref.line} = {
  type: '${ref.type}',
  importedNames: [${ref.importedNames.map(name => `'${name}'`).join(', ')}],
  isTypeOnly: ${ref.isTypeOnly},
  originalText: ${JSON.stringify(ref.text)},
};`).join('\n')}

export const ${fileName}Mock = {
  references: [${fileReferences.map((ref, index) => `mock${ref.type.charAt(0).toUpperCase() + ref.type.slice(1)}${ref.line}`).join(', ')}],
  totalReferences: ${fileReferences.length},
};`;
};

const generatePackageMockContent = (analysis: DeletableAnalysisResult): string => {
  const fileName = path.basename(analysis.filePath, path.extname(analysis.filePath));
  
  return `/**
 * Package-level mock for ${fileName}
 * 
 * This simulates the file as if it were an external package dependency.
 */

${analysis.exports.map(exp => {
  if (exp.name === 'default') {
    return `const ${fileName}Default = {};`;
  } else if (exp.type === 'function') {
    return `export const ${exp.name} = () => 'mocked-${exp.name}';`;
  } else if (exp.type === 'class') {
    return `export class ${exp.name} { constructor() {} }`;
  } else if (exp.type === 'type' || exp.type === 'interface') {
    return `export type ${exp.name} = any;`;
  } else {
    return `export const ${exp.name} = 'mocked-${exp.name}';`;
  }
}).join('\n')}

${analysis.exports.some(exp => exp.name === 'default') ? `export default ${fileName}Default;` : ''}

export const packageInfo = {
  name: '${fileName}',
  exports: [${analysis.exports.map(exp => `'${exp.name}'`).join(', ')}],
  isDeletable: ${analysis.isDeletable},
  mockGenerated: true,
};`;
};