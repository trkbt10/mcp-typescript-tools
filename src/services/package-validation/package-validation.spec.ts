import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { validatePackage } from './index';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('validatePackage', () => {
  const testDir = './test-package';
  const packageJsonPath = path.join(testDir, 'package.json');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('should validate basic package.json with valid main field', async () => {
    const packageJson = {
      name: 'test-package',
      main: 'index.js',
    };

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
    await fs.writeFile(path.join(testDir, 'index.js'), 'module.exports = {};');

    const result = await validatePackage({
      packageJsonPath,
      checkTypes: false,
      checkExports: false,
      checkTypesVersions: false,
    });

    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.fileResolution).toHaveLength(1);
    expect(result.fileResolution[0].field).toBe('main');
    expect(result.fileResolution[0].exists).toBe(true);
  });

  test('should detect missing main file', async () => {
    const packageJson = {
      name: 'test-package',
      main: 'missing.js',
    };

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));

    const result = await validatePackage({
      packageJsonPath,
      checkTypes: false,
      checkExports: false,
      checkTypesVersions: false,
    });

    expect(result.isValid).toBe(false);
    expect(result.issues).toContain('main field points to non-existent file: missing.js');
  });

  test('should validate exports field', async () => {
    const packageJson = {
      name: 'test-package',
      exports: {
        '.': './index.js',
        './utils': './utils.js',
      },
    };

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
    await fs.writeFile(path.join(testDir, 'index.js'), 'module.exports = {};');
    await fs.writeFile(path.join(testDir, 'utils.js'), 'module.exports = {};');

    const result = await validatePackage({
      packageJsonPath,
      checkTypes: false,
      checkExports: true,
      checkTypesVersions: false,
    });

    expect(result.isValid).toBe(true);
    expect(result.exportsValidation).toBeDefined();
    expect(result.exportsValidation).toHaveLength(2);
    expect(result.exportsValidation![0].exists).toBe(true);
    expect(result.exportsValidation![1].exists).toBe(true);
  });

  test('should warn about missing types field', async () => {
    const packageJson = {
      name: 'test-package',
      main: 'index.js',
    };

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
    await fs.writeFile(path.join(testDir, 'index.js'), 'module.exports = {};');

    const result = await validatePackage({
      packageJsonPath,
      checkTypes: true,
      checkExports: false,
      checkTypesVersions: false,
    });

    expect(result.warnings.some(w => w.includes('No types field specified'))).toBe(true);
  });
});