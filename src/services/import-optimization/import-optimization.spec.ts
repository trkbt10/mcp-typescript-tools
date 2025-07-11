import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { optimizeImports } from './index';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('optimizeImports', () => {
  const testDir = './test-import-optimization';

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('should remove unused imports', async () => {
    const testFile = path.join(testDir, 'test.ts');
    const content = `import { used, unused } from './module';
import { alsoUnused } from './other';

console.log(used);`;

    await fs.writeFile(testFile, content);

    const result = await optimizeImports({
      filePath: testFile,
      removeUnused: true,
      optimizeIndexPaths: false,
      consolidateImports: false,
      separateTypeImports: false,
    });

    expect(result.optimized).toBe(true);
    expect(result.changes.length).toBeGreaterThanOrEqual(2);
    expect(result.changes.some(c => c.reason.includes('unused'))).toBe(true);
    expect(result.changes.some(c => c.reason.includes('Entire import statement unused'))).toBe(true);
  });

  test('should optimize index paths', async () => {
    const testFile = path.join(testDir, 'test.ts');
    const content = `import { something } from './utils/index';
import { other } from './helpers/index';`;

    await fs.writeFile(testFile, content);

    const result = await optimizeImports({
      filePath: testFile,
      removeUnused: false,
      optimizeIndexPaths: true,
      consolidateImports: false,
      separateTypeImports: false,
    });

    expect(result.optimized).toBe(true);
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0].type).toBe('optimized_path');
    expect(result.changes[0].reason).toContain('Removed /index suffix');
    expect(result.optimizedCode).toContain("from './utils'");
    expect(result.optimizedCode).toContain("from './helpers'");
  });

  test('should consolidate imports from same module', async () => {
    const testFile = path.join(testDir, 'test.ts');
    const content = `import { first } from './module';
import { second } from './module';
import { third } from './module';

console.log(first, second, third);`;

    await fs.writeFile(testFile, content);

    const result = await optimizeImports({
      filePath: testFile,
      removeUnused: false,
      optimizeIndexPaths: false,
      consolidateImports: true,
      separateTypeImports: false,
    });

    expect(result.optimized).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].type).toBe('consolidated');
    expect(result.changes[0].reason).toContain('Consolidated 3 imports');
    expect(result.optimizedCode).toContain('{ first, second, third }');
  });

  test('should handle all optimizations together', async () => {
    const testFile = path.join(testDir, 'complex.ts');
    const content = `import { used, unused } from './module/index';
import { alsoUsed } from './module/index';
import { entirelyUnused } from './other/index';

function component() {
  return used + alsoUsed;
}`;

    await fs.writeFile(testFile, content);

    const result = await optimizeImports({
      filePath: testFile,
      removeUnused: true,
      optimizeIndexPaths: true,
      consolidateImports: true,
      separateTypeImports: false,
    });

    // Check if any optimization occurred
    if (result.error) {
      console.log('Error:', result.error);
    }
    
    expect(result.changes.length).toBeGreaterThan(0);
    
    // Should have some optimizations
    const hasOptimizations = result.changes.some(c => 
      c.type === 'removed' || 
      c.type === 'consolidated' || 
      c.type === 'optimized_path'
    );
    expect(hasOptimizations).toBe(true);
  });
});