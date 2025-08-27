import type { Project } from 'ts-morph';

export const cleanupProject = (project: Project): void => {
  try {
    // Clear module resolution cache
    const moduleResolutionHost = project.getModuleResolutionHost?.();
    if (moduleResolutionHost && 'clearCache' in moduleResolutionHost && typeof moduleResolutionHost.clearCache === 'function') {
      moduleResolutionHost.clearCache();
    }

    // Clean up compiler API
    const context = (project as any)._context;
    if (context?.compilerFactory?.removeCompilerApi) {
      context.compilerFactory.removeCompilerApi();
    }

    // Clear file system cache
    const fileSystemHost = project.getFileSystem?.();
    if (fileSystemHost && typeof (fileSystemHost as any).clearCache === 'function') {
      (fileSystemHost as any).clearCache();
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  } catch (error) {
    // Ignore cleanup errors - they're not critical
    console.error('Project cleanup warning:', error);
  }
};

export const withProjectCleanup = async <T>(
  projectFactory: () => Project,
  operation: (project: Project) => Promise<T>
): Promise<T> => {
  const project = projectFactory();
  try {
    return await operation(project);
  } finally {
    cleanupProject(project);
  }
};