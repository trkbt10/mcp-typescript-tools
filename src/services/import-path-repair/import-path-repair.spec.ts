import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { repairImportPaths, type ImportPathRepairOptions } from './index';
import { Project } from 'ts-morph';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Import Path Repair', () => {
  let testDir: string;
  let project: Project;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `import-repair-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create test file structure
    createTestFiles();
    project = new Project();
  });

  afterEach(() => {
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true });
  });

  function createTestFiles() {
    // Create source files
    const srcDir = join(testDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    // utils/math.ts
    const utilsDir = join(srcDir, 'utils');
    mkdirSync(utilsDir, { recursive: true });
    writeFileSync(join(utilsDir, 'math.ts'), `
export const add = (a: number, b: number) => a + b;
export const multiply = (a: number, b: number) => a * b;
export default function subtract(a: number, b: number) {
  return a - b;
}
    `);

    // components/Button.tsx
    const componentsDir = join(srcDir, 'components');
    mkdirSync(componentsDir, { recursive: true });
    writeFileSync(join(componentsDir, 'Button.tsx'), `
export type ButtonProps = {
  children: React.ReactNode;
  onClick: () => void;
};

export default function Button(props: ButtonProps) {
  return <button onClick={props.onClick}>{props.children}</button>;
}
    `);

    // services/api/index.ts
    const servicesDir = join(srcDir, 'services');
    const apiDir = join(servicesDir, 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'index.ts'), `
export const fetchData = async (url: string) => {
  return fetch(url);
};
export * from './client';
    `);

    // services/api/client.ts
    writeFileSync(join(apiDir, 'client.ts'), `
export class ApiClient {
  baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }
}
    `);

    // Test file with broken imports
    writeFileSync(join(testDir, 'test-file.ts'), `
import { add, multiply } from './src/wrong/path/math';
import Button from '../components/Button';
import type { ButtonProps } from './Button';
import { fetchData } from './api';
import * as ApiModule from './services/wrong/api';
import './some/missing/file';
    `);

    // Create tsconfig.json
    writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'node',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      },
      include: ['src/**/*', '*.ts'],
      exclude: ['node_modules', 'dist']
    }, null, 2));
  }

  it('should repair broken import paths correctly', async () => {
    const testFilePath = join(testDir, 'test-file.ts');
    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
      includeTypes: true,
      respectTsConfig: true,
      prioritizeCloserPaths: true,
    };

    const result = await repairImportPaths(options);

    expect(result.filePath).toBe(testFilePath);
    expect(result.totalImportsChecked).toBe(6);

    expect(result.errors).toHaveLength(0);

    // Check specific repairs - the first import should be repaired
    const mathImport = result.repairedImports.find(r => r.originalPath.includes('math'));
    expect(mathImport?.status).toBe('repaired');
    expect(mathImport?.repairedPath).toMatch(/\.\/src\/utils\/math$/);
    expect(mathImport?.namedImports).toEqual(['add', 'multiply']);

    // Check that several imports were successfully repaired
    const repairedCount = result.repairedImports.filter(r => r.status === 'repaired').length;
    expect(repairedCount).toBeGreaterThanOrEqual(4);

    // Check that at least one was not found (the missing file)
    const notFoundCount = result.repairedImports.filter(r => r.status === 'not_found').length;
    expect(notFoundCount).toBeGreaterThanOrEqual(1);
  });

  it('should prioritize files with matching exports', async () => {
    // Create another math file without the required exports
    const altDir = join(testDir, 'src', 'alternative');
    mkdirSync(altDir, { recursive: true });
    writeFileSync(join(altDir, 'math.ts'), `
export const divide = (a: number, b: number) => a / b;
// Missing add and multiply functions
    `);

    const testFilePath = join(testDir, 'test-specific.ts');
    writeFileSync(testFilePath, `
import { add, multiply } from './wrong/path/math';
    `);

    writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'node',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      },
      include: ['src/**/*', '*.ts'],
      exclude: ['node_modules', 'dist']
    }, null, 2));

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
    };

    const result = await repairImportPaths(options);
    const mathImport = result.repairedImports[0];

    expect(mathImport?.status).toBe('repaired');
    // Should select the file that has both 'add' and 'multiply' exports
    expect(mathImport?.selectedFile).toMatch(/src\/utils\/math\.ts$/);
    expect(mathImport?.reason).toContain('export matching');
  });

  it('should handle namespace imports correctly', async () => {
    const testFilePath = join(testDir, 'test-namespace.ts');
    writeFileSync(testFilePath, `
import * as MathUtils from './wrong/path/math';
    `);

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
    };

    const result = await repairImportPaths(options);
    const namespaceImport = result.repairedImports[0];

    expect(namespaceImport).toBeDefined();
    expect(namespaceImport.importType).toBe('namespace');
    expect(namespaceImport.status).toBe('repaired');
    expect(namespaceImport.repairedPath).toMatch(/\.\/src\/utils\/math$/);
  });

  it('should handle default imports correctly', async () => {
    const testFilePath = join(testDir, 'test-default.ts');
    writeFileSync(testFilePath, `
import subtract from './wrong/path/math';
    `);

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
    };

    const result = await repairImportPaths(options);
    const defaultImport = result.repairedImports[0];

    expect(defaultImport).toBeDefined();
    expect(defaultImport.importType).toBe('default');
    expect(defaultImport.status).toBe('repaired');
    expect(defaultImport.repairedPath).toMatch(/\.\/src\/utils\/math$/);
  });

  it('should skip external module imports', async () => {
    const testFilePath = join(testDir, 'test-external.ts');
    writeFileSync(testFilePath, `
import React from 'react';
import { useState } from 'react';
import axios from 'axios';
    `);

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
    };

    const result = await repairImportPaths(options);

    expect(result.repairedImports).toHaveLength(3);
    result.repairedImports.forEach(repair => {
      expect(repair.status).toBe('already_valid');
      expect(repair.reason).toBe('External module import');
    });
  });

  it('should report not found for genuinely missing files', async () => {
    const testFilePath = join(testDir, 'test-missing.ts');
    writeFileSync(testFilePath, `
import { nonExistentFunction } from './completely-missing-file';
    `);

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
    };

    const result = await repairImportPaths(options);
    const missingImport = result.repairedImports[0];

    expect(missingImport).toBeDefined();
    expect(missingImport.status).toBe('not_found');
    expect(missingImport.reason).toContain('No matching files found');
  });

  it('should prioritize closer paths when multiple matches exist', async () => {
    // Create a nested structure with duplicate file names
    const nestedDir = join(testDir, 'src', 'deeply', 'nested', 'path');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'math.ts'), `
export const add = (a: number, b: number) => a + b;
export const multiply = (a: number, b: number) => a * b;
    `);

    const testFilePath = join(testDir, 'src', 'test-proximity.ts');
    writeFileSync(testFilePath, `
import { add } from './wrong/math';
    `);

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
      prioritizeCloserPaths: true,
    };

    const result = await repairImportPaths(options);
    const mathImport = result.repairedImports[0];

    expect(mathImport).toBeDefined();
    expect(mathImport.status).toBe('repaired');
    // Should prefer the closer utils/math.ts over deeply/nested/path/math.ts
    expect(mathImport.selectedFile).toMatch(/src\/utils\/math\.ts$/);
  });

  it('should handle already valid imports correctly', async () => {
    const testFilePath = join(testDir, 'src', 'test-valid.ts');
    writeFileSync(testFilePath, `
import { add } from './utils/math';
import Button from './components/Button';
    `);

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: true,
    };

    const result = await repairImportPaths(options);

    expect(result.repairedImports).toHaveLength(2);
    result.repairedImports.forEach(repair => {
      expect(repair.status).toBe('already_valid');
      expect(repair.reason).toBe('Path already valid');
    });
  });

  it('should actually repair imports when dryRun is false', async () => {
    const testFilePath = join(testDir, 'test-actual-repair.ts');
    writeFileSync(testFilePath, `
import { add } from './wrong/path/math';
    `);

    const options: ImportPathRepairOptions = {
      filePath: testFilePath,
      dryRun: false,
    };

    const result = await repairImportPaths(options);

    expect(result.totalImportsRepaired).toBe(1);

    // Read the file back and check it was actually modified
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(testFilePath);
    const imports = sourceFile.getImportDeclarations();
    
    expect(imports[0]?.getModuleSpecifierValue()).toMatch(/\.\/src\/utils\/math$/);
  });
});