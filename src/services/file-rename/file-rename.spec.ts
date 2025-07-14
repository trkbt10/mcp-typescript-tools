import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { renameFileOrFolder } from './index';

describe('renameFileOrFolder', () => {
  const testDir = path.join(process.cwd(), '__test_rename__');
  
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('File Renaming', () => {
    it('should rename a file without imports', async () => {
      const sourcePath = path.join(testDir, 'oldFile.ts');
      const destPath = path.join(testDir, 'newFile.ts');
      
      await fs.writeFile(sourcePath, 'export const value = 42;');
      
      const result = await renameFileOrFolder({
        sourcePath,
        destinationPath: destPath,
        updateImports: false
      });
      
      expect(result.success).toBe(true);
      expect(await fs.access(destPath).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(sourcePath).then(() => true).catch(() => false)).toBe(false);
    });

    it('should rename a file and update imports', async () => {
      // Create files
      const oldFilePath = path.join(testDir, 'utils', 'oldUtil.ts');
      const newFilePath = path.join(testDir, 'utils', 'newUtil.ts');
      const consumerPath = path.join(testDir, 'consumer.ts');
      
      await fs.mkdir(path.join(testDir, 'utils'), { recursive: true });
      await fs.writeFile(oldFilePath, 'export const utilFunction = () => "test";');
      await fs.writeFile(consumerPath, `import { utilFunction } from './utils/oldUtil';\nconsole.log(utilFunction());`);
      
      // Create tsconfig.json
      await fs.writeFile(
        path.join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
            strict: true
          }
        })
      );
      
      process.chdir(testDir);
      
      const result = await renameFileOrFolder({
        sourcePath: oldFilePath,
        destinationPath: newFilePath,
        updateImports: true
      });
      
      expect(result.success).toBe(true);
      expect(result.updatedFiles?.length).toBeGreaterThan(0);
      expect(result.affectedImports?.length).toBeGreaterThan(0);
      
      // The consumer file should still be at the same path
      const updatedContent = await fs.readFile(consumerPath, 'utf-8');
      expect(updatedContent).toContain('./utils/newUtil');
      expect(updatedContent).not.toContain('./utils/oldUtil');
      
      // The old file should not exist
      const oldFileExists = await fs.access(oldFilePath).then(() => true).catch(() => false);
      expect(oldFileExists).toBe(false);
      
      // The new file should exist
      const newFileExists = await fs.access(newFilePath).then(() => true).catch(() => false);
      expect(newFileExists).toBe(true);
      
      process.chdir(path.dirname(testDir));
    });

    it('should handle file rename errors gracefully', async () => {
      const result = await renameFileOrFolder({
        sourcePath: '/nonexistent/path.ts',
        destinationPath: '/another/nonexistent/path.ts'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Folder Renaming', () => {
    it('should rename a folder and update all imports', async () => {
      // Create folder structure
      const oldFolderPath = path.join(testDir, 'oldFolder');
      const newFolderPath = path.join(testDir, 'newFolder');
      const file1Path = path.join(oldFolderPath, 'file1.ts');
      const file2Path = path.join(oldFolderPath, 'file2.ts');
      const consumerPath = path.join(testDir, 'consumer.ts');
      
      await fs.mkdir(oldFolderPath, { recursive: true });
      await fs.writeFile(file1Path, 'export const func1 = () => "func1";');
      await fs.writeFile(file2Path, 'export const func2 = () => "func2";');
      await fs.writeFile(
        consumerPath, 
        `import { func1 } from './oldFolder/file1';\nimport { func2 } from './oldFolder/file2';\nconsole.log(func1(), func2());`
      );
      
      // Create tsconfig.json
      await fs.writeFile(
        path.join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
            strict: true
          }
        })
      );
      
      process.chdir(testDir);
      
      const result = await renameFileOrFolder({
        sourcePath: oldFolderPath,
        destinationPath: newFolderPath,
        updateImports: true
      });
      
      expect(result.success).toBe(true);
      expect(result.isDirectory).toBe(true);
      expect(result.affectedImports?.length).toBeGreaterThan(0);
      
      const updatedContent = await fs.readFile(consumerPath, 'utf-8');
      expect(updatedContent).toContain('./newFolder/file1');
      expect(updatedContent).toContain('./newFolder/file2');
      expect(updatedContent).not.toContain('./oldFolder');
      
      process.chdir(path.dirname(testDir));
    });

    it('should handle destination already exists error', async () => {
      const oldPath = path.join(testDir, 'folder1');
      const newPath = path.join(testDir, 'folder2');
      
      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(newPath, { recursive: true });
      
      const result = await renameFileOrFolder({
        sourcePath: oldPath,
        destinationPath: newPath
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('Import Path Updates', () => {
    it('should update relative imports correctly', async () => {
      // Create nested structure
      const srcDir = path.join(testDir, 'src');
      const utilsDir = path.join(srcDir, 'utils');
      const componentsDir = path.join(srcDir, 'components');
      
      await fs.mkdir(utilsDir, { recursive: true });
      await fs.mkdir(componentsDir, { recursive: true });
      
      const utilFile = path.join(utilsDir, 'helper.ts');
      const componentFile = path.join(componentsDir, 'MyComponent.ts');
      
      await fs.writeFile(utilFile, 'export const helper = () => "help";');
      await fs.writeFile(componentFile, `import { helper } from '../utils/helper';\nexport const Component = () => helper();`);
      
      // Create tsconfig.json
      await fs.writeFile(
        path.join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
            strict: true
          }
        })
      );
      
      process.chdir(testDir);
      
      // Rename utils to helpers
      const result = await renameFileOrFolder({
        sourcePath: utilsDir,
        destinationPath: path.join(srcDir, 'helpers'),
        updateImports: true
      });
      
      expect(result.success).toBe(true);
      
      const updatedContent = await fs.readFile(componentFile, 'utf-8');
      expect(updatedContent).toContain('../helpers/helper');
      
      process.chdir(path.dirname(testDir));
    });

    it('should handle dynamic imports', async () => {
      const oldFile = path.join(testDir, 'oldDynamic.ts');
      const newFile = path.join(testDir, 'newDynamic.ts');
      const consumerFile = path.join(testDir, 'consumer.ts');
      
      await fs.writeFile(oldFile, 'export default { value: 42 };');
      await fs.writeFile(
        consumerFile, 
        `const module = await import('./oldDynamic');\nconsole.log(module.default.value);`
      );
      
      // Create tsconfig.json
      await fs.writeFile(
        path.join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
            strict: true
          }
        })
      );
      
      process.chdir(testDir);
      
      const result = await renameFileOrFolder({
        sourcePath: oldFile,
        destinationPath: newFile,
        updateImports: true
      });
      
      expect(result.success).toBe(true);
      
      const updatedContent = await fs.readFile(consumerFile, 'utf-8');
      expect(updatedContent).toContain("import('./newDynamic')");
      
      process.chdir(path.dirname(testDir));
    });

    it('should preserve import path style (with/without extensions)', async () => {
      const oldFile = path.join(testDir, 'oldStyle.ts');
      const newFile = path.join(testDir, 'newStyle.ts');
      const consumer1 = path.join(testDir, 'consumer1.ts');
      const consumer2 = path.join(testDir, 'consumer2.ts');
      
      await fs.writeFile(oldFile, 'export const value = 42;');
      await fs.writeFile(consumer1, `import { value } from './oldStyle';\n`);
      await fs.writeFile(consumer2, `import { value } from './oldStyle.ts';\n`);
      
      // Create tsconfig.json
      await fs.writeFile(
        path.join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
            strict: true
          }
        })
      );
      
      process.chdir(testDir);
      
      const result = await renameFileOrFolder({
        sourcePath: oldFile,
        destinationPath: newFile,
        updateImports: true
      });
      
      expect(result.success).toBe(true);
      
      const content1 = await fs.readFile(consumer1, 'utf-8');
      const content2 = await fs.readFile(consumer2, 'utf-8');
      
      expect(content1).toContain('./newStyle');
      expect(content1).not.toContain('.ts');
      expect(content2).toContain('./newStyle.ts');
      
      process.chdir(path.dirname(testDir));
    });
  });
});