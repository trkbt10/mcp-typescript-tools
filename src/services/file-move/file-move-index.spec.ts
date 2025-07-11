import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { moveTypeScriptFile } from './index';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('moveTypeScriptFile - index file handling', () => {
  const testDir = './test-move-index';

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'utils'), { recursive: true });
    
    // Create tsconfig.json
    await fs.writeFile(
      path.join(testDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          strict: true,
        },
        include: ['src/**/*'],
      })
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('should use directory reference when moving index.ts file', async () => {
    const indexFile = path.join(testDir, 'src', 'utils', 'index.ts');
    const importerFile = path.join(testDir, 'src', 'main.ts');
    const newIndexFile = path.join(testDir, 'src', 'helpers', 'index.ts');

    // Create index file
    await fs.mkdir(path.join(testDir, 'src', 'utils'), { recursive: true });
    await fs.writeFile(indexFile, 'export const util = () => {};');

    // Create file that imports the index
    await fs.writeFile(
      importerFile,
      "import { util } from './utils/index';\nconsole.log(util());"
    );

    // Create destination directory
    await fs.mkdir(path.join(testDir, 'src', 'helpers'), { recursive: true });

    const result = await moveTypeScriptFile({
      source: indexFile,
      destination: newIndexFile,
      updateImports: true,
    });

    expect(result.success).toBe(true);

    // Check that import was updated to use directory reference
    const updatedContent = await fs.readFile(importerFile, 'utf-8');
    expect(updatedContent).toContain("import { util } from './helpers';");
    expect(updatedContent).not.toContain('./helpers/index');
  });

  test('should preserve full path for non-index files even with index present', async () => {
    const utilFile = path.join(testDir, 'src', 'utils', 'helper.ts');
    const indexFile = path.join(testDir, 'src', 'utils', 'index.ts');
    const importerFile = path.join(testDir, 'src', 'main.ts');
    const newUtilFile = path.join(testDir, 'src', 'helpers', 'helper.ts');

    // Create both helper and index files
    await fs.mkdir(path.join(testDir, 'src', 'utils'), { recursive: true });
    await fs.writeFile(utilFile, 'export const helper = () => {};');
    await fs.writeFile(indexFile, 'export * from "./helper";');

    // Create file that imports the helper directly
    await fs.writeFile(
      importerFile,
      "import { helper } from './utils/helper';\nconsole.log(helper());"
    );

    // Create destination directory
    await fs.mkdir(path.join(testDir, 'src', 'helpers'), { recursive: true });

    const result = await moveTypeScriptFile({
      source: utilFile,
      destination: newUtilFile,
      updateImports: true,
    });

    expect(result.success).toBe(true);

    // Check that import was updated to the full path
    const updatedContent = await fs.readFile(importerFile, 'utf-8');
    expect(updatedContent).toContain("import { helper } from './helpers/helper';");
  });
});