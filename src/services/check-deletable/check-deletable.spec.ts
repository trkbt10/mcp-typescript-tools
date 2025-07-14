import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { checkDeletable } from './index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('checkDeletable', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deletable-test-'));
    
    // Create a mock tsconfig.json
    fs.writeFileSync(
      path.join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
          strict: true,
        },
        include: ['**/*.ts', '**/*.tsx'],
      })
    );
    
    // Change to test directory
    process.chdir(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should detect file as deletable when no references exist', async () => {
    // Create a standalone file with no references
    const targetFile = path.join(testDir, 'standalone.ts');
    fs.writeFileSync(targetFile, `
export const standaloneFunction = () => {
  return 'hello world';
};
    `);

    const result = await checkDeletable({ filePath: targetFile });

    expect(result.analysis.isDeletable).toBe(true);
    expect(result.analysis.references).toHaveLength(0);
    expect(result.analysis.summary).toBe('File can be safely deleted - no references found');
  });

  it('should detect file as not deletable when direct import exists', async () => {
    // Create target file
    const targetFile = path.join(testDir, 'target.ts');
    fs.writeFileSync(targetFile, `
export const targetFunction = () => {
  return 'target';
};
    `);

    // Create file that imports target
    const importerFile = path.join(testDir, 'importer.ts');
    fs.writeFileSync(importerFile, `
import { targetFunction } from './target';

export const useTarget = () => {
  return targetFunction();
};
    `);

    const result = await checkDeletable({ filePath: targetFile });

    expect(result.analysis.isDeletable).toBe(false);
    expect(result.analysis.references).toHaveLength(1);
    expect(result.analysis.references[0].type).toBe('import');
    expect(result.analysis.references[0].file).toBe(fs.realpathSync(importerFile));
    expect(result.analysis.references[0].importedNames).toEqual(['targetFunction']);
  });

  it('should detect wildcard export references', async () => {
    // Create target file
    const targetFile = path.join(testDir, 'target.ts');
    fs.writeFileSync(targetFile, `
export const targetFunction = () => {
  return 'target';
};
    `);

    // Create file that re-exports everything from target
    const reExporterFile = path.join(testDir, 'reexporter.ts');
    fs.writeFileSync(reExporterFile, `
export * from './target';
    `);

    const result = await checkDeletable({ filePath: targetFile });

    expect(result.analysis.isDeletable).toBe(false);
    expect(result.analysis.references).toHaveLength(1);
    expect(result.analysis.references[0].type).toBe('export');
    expect(result.analysis.references[0].file).toBe(fs.realpathSync(reExporterFile));
    expect(result.analysis.references[0].importedNames).toEqual(['*']);
  });

  it('should detect default import references', async () => {
    // Create target file with default export
    const targetFile = path.join(testDir, 'target.ts');
    fs.writeFileSync(targetFile, `
const defaultExport = {
  value: 'default'
};

export default defaultExport;
    `);

    // Create file that imports default
    const importerFile = path.join(testDir, 'importer.ts');
    fs.writeFileSync(importerFile, `
import targetDefault from './target';

export const useDefault = () => {
  return targetDefault.value;
};
    `);

    const result = await checkDeletable({ filePath: targetFile });

    expect(result.analysis.isDeletable).toBe(false);
    expect(result.analysis.references).toHaveLength(1);
    expect(result.analysis.references[0].type).toBe('import');
    expect(result.analysis.references[0].importedNames).toEqual(['default as targetDefault']);
  });

  it('should detect namespace import references', async () => {
    // Create target file
    const targetFile = path.join(testDir, 'target.ts');
    fs.writeFileSync(targetFile, `
export const func1 = () => 'func1';
export const func2 = () => 'func2';
    `);

    // Create file that imports namespace
    const importerFile = path.join(testDir, 'importer.ts');
    fs.writeFileSync(importerFile, `
import * as Target from './target';

export const useNamespace = () => {
  return Target.func1() + Target.func2();
};
    `);

    const result = await checkDeletable({ filePath: targetFile });

    expect(result.analysis.isDeletable).toBe(false);
    expect(result.analysis.references).toHaveLength(1);
    expect(result.analysis.references[0].type).toBe('import');
    expect(result.analysis.references[0].importedNames).toEqual(['* as Target']);
  });

  it('should handle index.ts files correctly', async () => {
    // Create directory with index.ts
    const subDir = path.join(testDir, 'utils');
    fs.mkdirSync(subDir);
    const indexFile = path.join(subDir, 'index.ts');
    fs.writeFileSync(indexFile, `
export const utilFunction = () => {
  return 'util';
};
    `);

    // Create file that imports from directory (which resolves to index.ts)
    const importerFile = path.join(testDir, 'importer.ts');
    fs.writeFileSync(importerFile, `
import { utilFunction } from './utils';

export const useUtil = () => {
  return utilFunction();
};
    `);

    const result = await checkDeletable({ filePath: indexFile });

    expect(result.analysis.isDeletable).toBe(false);
    expect(result.analysis.references).toHaveLength(1);
    expect(result.analysis.references[0].type).toBe('import');
  });

  it('should respect includeTypes option for type-only imports', async () => {
    // Create target file with type export
    const targetFile = path.join(testDir, 'types.ts');
    fs.writeFileSync(targetFile, `
export type MyType = {
  value: string;
};
    `);

    // Create file that imports type only
    const importerFile = path.join(testDir, 'importer.ts');
    fs.writeFileSync(importerFile, `
import type { MyType } from './types';

export const createObject = (): MyType => {
  return { value: 'test' };
};
    `);

    // Test with includeTypes: true (default)
    const resultWithTypes = await checkDeletable({ filePath: targetFile, includeTypes: true });
    expect(resultWithTypes.analysis.isDeletable).toBe(false);
    expect(resultWithTypes.analysis.references).toHaveLength(1);
    expect(resultWithTypes.analysis.references[0].isTypeOnly).toBe(true);

    // Test with includeTypes: false
    const resultWithoutTypes = await checkDeletable({ filePath: targetFile, includeTypes: false });
    expect(resultWithoutTypes.analysis.isDeletable).toBe(true);
    expect(resultWithoutTypes.analysis.references).toHaveLength(0);
  });

  it('should handle mixed import types correctly', async () => {
    // Create target file with both type and value exports
    const targetFile = path.join(testDir, 'mixed.ts');
    fs.writeFileSync(targetFile, `
export type Config = {
  enabled: boolean;
};

export const defaultConfig: Config = {
  enabled: true;
};
    `);

    // Create files with different import types
    const typeImporterFile = path.join(testDir, 'type-importer.ts');
    fs.writeFileSync(typeImporterFile, `
import type { Config } from './mixed';

export const processConfig = (config: Config) => {
  return config.enabled;
};
    `);

    const valueImporterFile = path.join(testDir, 'value-importer.ts');
    fs.writeFileSync(valueImporterFile, `
import { defaultConfig } from './mixed';

export const getDefault = () => {
  return defaultConfig;
};
    `);

    const result = await checkDeletable({ filePath: targetFile });

    expect(result.analysis.isDeletable).toBe(false);
    expect(result.analysis.references).toHaveLength(2);
    
    const typeRef = result.analysis.references.find(ref => ref.isTypeOnly);
    const valueRef = result.analysis.references.find(ref => !ref.isTypeOnly);
    
    expect(typeRef).toBeDefined();
    expect(valueRef).toBeDefined();
    expect(typeRef?.file).toBe(fs.realpathSync(typeImporterFile));
    expect(valueRef?.file).toBe(fs.realpathSync(valueImporterFile));
  });

  it('should return error for non-existent file', async () => {
    const nonExistentFile = path.join(testDir, 'does-not-exist.ts');

    const result = await checkDeletable({ filePath: nonExistentFile });

    expect(result.analysis.isDeletable).toBe(false);
    expect(result.analysis.error).toContain('File not found');
    expect(result.analysis.references).toHaveLength(0);
  });

  it('should generate appropriate summary messages', async () => {
    // Create target file
    const targetFile = path.join(testDir, 'target.ts');
    fs.writeFileSync(targetFile, `
export const targetFunction = () => 'target';
export type TargetType = string;
    `);

    // Create multiple importers
    const importer1 = path.join(testDir, 'importer1.ts');
    fs.writeFileSync(importer1, `
import { targetFunction } from './target';
export const use1 = () => targetFunction();
    `);

    const importer2 = path.join(testDir, 'importer2.ts');
    fs.writeFileSync(importer2, `
import type { TargetType } from './target';
export const use2: TargetType = 'test';
    `);

    const result = await checkDeletable({ filePath: targetFile });

    expect(result.analysis.summary).toContain('Cannot delete');
    expect(result.analysis.summary).toContain('2 reference');
    expect(result.analysis.summary).toContain('2 file');
    expect(result.analysis.summary).toContain('1 type-only');
  });

  it('should generate test files when requested', async () => {
    // Create target file
    const targetFile = path.join(testDir, 'target.ts');
    fs.writeFileSync(targetFile, `
export const targetFunction = () => {
  return 'target';
};
    `);

    // Create file that imports target
    const importerFile = path.join(testDir, 'importer.ts');
    fs.writeFileSync(importerFile, `
import { targetFunction } from './target';

export const useTarget = () => {
  return targetFunction();
};
    `);

    const result = await checkDeletable({ 
      filePath: targetFile, 
      generateTests: true 
    });

    expect(result.testFileGenerated).toBeDefined();
    expect(result.testFileGenerated).toBe(path.join(testDir, 'target.spec.ts'));
    expect(fs.existsSync(result.testFileGenerated!)).toBe(true);

    // Check test file content
    const testContent = fs.readFileSync(result.testFileGenerated!, 'utf-8');
    expect(testContent).toContain('target - Deletion Safety Test');
    expect(testContent).toContain('should be unsafe to delete');
    expect(testContent).toContain('import { targetFunction }');
  });

  it('should create mock structure when requested', async () => {
    // Create target file
    const targetFile = path.join(testDir, 'target.ts');
    fs.writeFileSync(targetFile, `
export const targetFunction = () => {
  return 'target';
};
    `);

    // Create file that imports target
    const importerFile = path.join(testDir, 'importer.ts');
    fs.writeFileSync(importerFile, `
import { targetFunction } from './target';

export const useTarget = () => {
  return targetFunction();
};
    `);

    const result = await checkDeletable({ 
      filePath: targetFile, 
      createMocks: true 
    });

    expect(result.mockFilesGenerated).toBeDefined();
    expect(result.mockFilesGenerated!.length).toBeGreaterThan(0);
    
    // Check that __mocks__ directory was created
    const mocksDir = path.join(testDir, '__mocks__');
    expect(fs.existsSync(mocksDir)).toBe(true);

    // Check that mock files exist
    result.mockFilesGenerated!.forEach(mockFile => {
      expect(fs.existsSync(mockFile)).toBe(true);
    });
  });
});