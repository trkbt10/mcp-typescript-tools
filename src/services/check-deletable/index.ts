import type { CheckDeletableOptions, CheckDeletableResult } from '../../types';
import { analyzeFileDeletability } from './analysis';
import { generateTestFile, createMockStructure } from './execution';

export const checkDeletable = async (
  options: CheckDeletableOptions
): Promise<CheckDeletableResult> => {
  const { filePath, includeTypes = true, generateTests = false, createMocks = false } = options;

  try {
    // Phase 1: Analysis
    const analysis = await analyzeFileDeletability(filePath, includeTypes);
    
    if (analysis.error) {
      return {
        analysis,
        error: analysis.error,
      };
    }

    // Phase 2: Execution (optional)
    let testFileGenerated: string | undefined;
    let mockFilesGenerated: string[] = [];

    if (generateTests) {
      testFileGenerated = await generateTestFile(analysis);
    }

    if (createMocks) {
      mockFilesGenerated = await createMockStructure(analysis);
    }

    return {
      analysis,
      testFileGenerated,
      mockFilesGenerated,
    };
  } catch (error) {
    return {
      analysis: {
        filePath,
        isDeletable: false,
        error: error instanceof Error ? error.message : String(error),
        references: [],
        exports: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

