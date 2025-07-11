import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { moveTypeScriptFile } from './index';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('moveTypeScriptFile', () => {
  const testDir = './test-files';
  const sourceFile = path.join(testDir, 'source.ts');
  const destFile = path.join(testDir, 'dest.ts');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('should return error when source file does not exist', async () => {
    const result = await moveTypeScriptFile({
      source: sourceFile,
      destination: destFile,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should move file without updating imports when updateImports is false', async () => {
    await fs.writeFile(sourceFile, 'export const hello = "world";');
    
    const result = await moveTypeScriptFile({
      source: sourceFile,
      destination: destFile,
      updateImports: false,
    });

    expect(result.success).toBe(true);
    expect(await fs.access(destFile).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.access(sourceFile).then(() => true).catch(() => false)).toBe(false);
  });
});