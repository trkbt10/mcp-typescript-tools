import { expect, test, beforeEach } from 'bun:test';
import { mkdtemp, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { organizeComments } from './index';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'comment-org-test-'));
});

test('should deduplicate identical file comments', async () => {
  const testFile = join(tempDir, 'test.ts');
  const content = `/**
 * @file Application use-cases for organizations and projects
 */
/**
 * @file Application use-cases for organizations and projects
 */
import { organizationRepository } from "./repositories/organization";

export const getOrganization = async (id: string) => {
  return organizationRepository.get(id);
};`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile, {
    deduplicateComments: true,
    moveToTop: true
  });

  expect(result.success).toBe(true);
  expect(result.changes.deduplicated.length).toBeGreaterThan(0);
  
  const updatedContent = await readFile(testFile, 'utf-8');
  const commentMatches = updatedContent.match(/\/\*\*[\s\S]*?\*\//g);
  expect(commentMatches?.length).toBe(1);
});

test('should move file-level comments to top', async () => {
  const testFile = join(tempDir, 'test.ts');
  const content = `import { repo } from "./repo";

/**
 * @file Main application file
 */
export const app = () => {
  // This is an inline comment
  return repo.getData();
};

/**
 * @file Secondary description
 */`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile, {
    moveToTop: true
  });

  expect(result.success).toBe(true);
  
  const updatedContent = await readFile(testFile, 'utf-8');
  const lines = updatedContent.split('\n');
  expect(lines[0]).toMatch(/\/\*\*/);
});

test('should preserve inline comments when requested', async () => {
  const testFile = join(tempDir, 'test.ts');
  const content = `export const func = () => {
  const x = 5; // This is important
  return x * 2;
};`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile, { preserveInlineComments: true });

  expect(result.success).toBe(true);
  
  const updatedContent = await readFile(testFile, 'utf-8');
  expect(updatedContent).toContain('// This is important');
});

test('should remove empty comments', async () => {
  const testFile = join(tempDir, 'test.ts');
  const content = `/**
 * 
 */
/**
 * Valid comment
 */
//
export const func = () => {};`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile, { removeEmptyComments: true });

  expect(result.success).toBe(true);
  
  const updatedContent = await readFile(testFile, 'utf-8');
  expect(updatedContent).toContain('Valid comment');
  expect(updatedContent).not.toMatch(/\/\*\*\s*\*\//);
});

test('should handle JSDoc comments correctly', async () => {
  const testFile = join(tempDir, 'test.ts');
  const content = `/**
 * @description Main function
 * @param x The parameter
 */
/**
 * @description Main function
 * @param x The parameter
 */
export const func = (x: number) => x * 2;`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile, {
    deduplicateComments: true,
    moveToTop: true
  });

  expect(result.success).toBe(true);
  expect(result.changes.deduplicated.length).toBeGreaterThan(0);
});

test('should consolidate multiple unique file comments', async () => {
  const testFile = join(tempDir, 'test.ts');
  const content = `/**
 * @file Main application module
 */
/**
 * @author John Doe
 */
/**
 * @version 1.0.0
 */
export const app = () => {};`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile, {
    moveToTop: true
  });

  expect(result.success).toBe(true);
  expect(result.changes.moved.length).toBeGreaterThan(0);
  
  const updatedContent = await readFile(testFile, 'utf-8');
  expect(updatedContent).toContain('Main application module');
  expect(updatedContent).toContain('John Doe');
  expect(updatedContent).toContain('1.0.0');
});

test('should handle files with no comments gracefully', async () => {
  const testFile = join(tempDir, 'test.ts');
  const content = `export const func = () => {
  return 42;
};`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile);

  expect(result.success).toBe(true);
  expect(result.changes.moved.length).toBe(0);
  expect(result.changes.deduplicated.length).toBe(0);
});

test('should handle invalid TypeScript file', async () => {
  const testFile = join(tempDir, 'invalid.ts');
  const content = `export const func = ({{ invalid syntax`;

  await writeFile(testFile, content);
  const result = await organizeComments(testFile);

  expect(result.success).toBe(true);
});