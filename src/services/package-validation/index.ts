import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  PackageValidationOptions,
  PackageValidationResult,
  FileResolutionInfo,
  ExportsValidationInfo,
  TypesVersionsValidationInfo,
} from '../../types';

export const validatePackage = async (
  options: PackageValidationOptions
): Promise<PackageValidationResult> => {
  const { packageJsonPath, checkTypes = true, checkExports = true, checkTypesVersions = true } = options;

  try {
    const packageJson = await readPackageJson(packageJsonPath);
    const packageDir = path.dirname(packageJsonPath);

    const issues: string[] = [];
    const warnings: string[] = [];
    const fileResolution: FileResolutionInfo[] = [];
    let exportsValidation: ExportsValidationInfo[] | undefined;
    let typesVersionsValidation: TypesVersionsValidationInfo[] | undefined;

    // Check basic file resolution fields
    await checkBasicFileResolution(packageJson, packageDir, fileResolution, issues, warnings);

    // Check types resolution
    if (checkTypes) {
      await checkTypesResolution(packageJson, packageDir, fileResolution, issues, warnings);
    }

    // Check exports field
    if (checkExports && packageJson.exports) {
      exportsValidation = await validateExports(packageJson.exports, packageDir, issues, warnings);
    }

    // Check typesVersions field
    if (checkTypesVersions && packageJson.typesVersions) {
      typesVersionsValidation = await validateTypesVersions(
        packageJson.typesVersions,
        packageDir,
        issues,
        warnings
      );
    }

    return {
      packagePath: packageJsonPath,
      isValid: issues.length === 0,
      issues,
      warnings,
      fileResolution,
      exportsValidation,
      typesVersionsValidation,
    };
  } catch (error) {
    return {
      packagePath: packageJsonPath,
      isValid: false,
      issues: [],
      warnings: [],
      fileResolution: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const readPackageJson = async (packageJsonPath: string): Promise<any> => {
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  return JSON.parse(content);
};

const checkBasicFileResolution = async (
  packageJson: any,
  packageDir: string,
  fileResolution: FileResolutionInfo[],
  issues: string[],
  warnings: string[]
): Promise<void> => {
  const fieldsToCheck = ['main', 'module', 'browser', 'types', 'typings'];

  for (const field of fieldsToCheck) {
    if (packageJson[field]) {
      const info = await checkFileExists(field, packageJson[field], packageDir);
      fileResolution.push(info);

      if (!info.exists) {
        issues.push(`${field} field points to non-existent file: ${info.value}`);
      }
    }
  }

  // Check bin field
  if (packageJson.bin) {
    if (typeof packageJson.bin === 'string') {
      const info = await checkFileExists('bin', packageJson.bin, packageDir);
      fileResolution.push(info);
      if (!info.exists) {
        issues.push(`bin field points to non-existent file: ${info.value}`);
      }
    } else if (typeof packageJson.bin === 'object') {
      for (const [binName, binPath] of Object.entries(packageJson.bin)) {
        const info = await checkFileExists(`bin.${binName}`, binPath as string, packageDir);
        fileResolution.push(info);
        if (!info.exists) {
          issues.push(`bin.${binName} points to non-existent file: ${binPath}`);
        }
      }
    }
  }
};

const checkTypesResolution = async (
  packageJson: any,
  packageDir: string,
  fileResolution: FileResolutionInfo[],
  issues: string[],
  warnings: string[]
): Promise<void> => {
  // Check if types field is present when main field exists
  if (packageJson.main && !packageJson.types && !packageJson.typings) {
    // Try to find corresponding .d.ts file
    const mainFile = packageJson.main;
    const possibleTypesFiles = [
      mainFile.replace(/\.js$/, '.d.ts'),
      mainFile.replace(/\.js$/, '.d.ts'),
      'index.d.ts',
      'dist/index.d.ts',
      'lib/index.d.ts',
    ];

    let foundTypes = false;
    for (const typesFile of possibleTypesFiles) {
      const info = await checkFileExists(`types (inferred)`, typesFile, packageDir);
      if (info.exists) {
        fileResolution.push(info);
        foundTypes = true;
        warnings.push(`Found types file at ${typesFile}, consider adding 'types' field to package.json`);
        break;
      }
    }

    if (!foundTypes) {
      warnings.push('No types field specified and no corresponding .d.ts file found');
    }
  }

  // Check module field types
  if (packageJson.module && !packageJson.types) {
    const moduleFile = packageJson.module;
    const moduleTypesFile = moduleFile.replace(/\.js$/, '.d.ts');
    const info = await checkFileExists('module types (inferred)', moduleTypesFile, packageDir);
    fileResolution.push(info);
    
    if (!info.exists) {
      warnings.push(`Module field specified but no corresponding types file found: ${moduleTypesFile}`);
    }
  }
};

const validateExports = async (
  exports: any,
  packageDir: string,
  issues: string[],
  warnings: string[]
): Promise<ExportsValidationInfo[]> => {
  const validationInfo: ExportsValidationInfo[] = [];

  const validateExportEntry = async (exportPath: string, value: any, condition?: string) => {
    if (typeof value === 'string') {
      const resolvedPath = path.resolve(packageDir, value);
      const exists = await fileExists(resolvedPath);
      
      validationInfo.push({
        path: exportPath,
        condition,
        resolvedFile: value,
        exists,
        error: exists ? undefined : `File not found: ${value}`,
      });

      if (!exists) {
        issues.push(`Export '${exportPath}' ${condition ? `(${condition})` : ''} points to non-existent file: ${value}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      // Handle conditional exports
      for (const [cond, condValue] of Object.entries(value)) {
        await validateExportEntry(`${exportPath}`, condValue, cond);
      }
    }
  };

  if (typeof exports === 'string') {
    await validateExportEntry('.', exports);
  } else if (typeof exports === 'object' && exports !== null) {
    for (const [exportPath, exportValue] of Object.entries(exports)) {
      await validateExportEntry(exportPath, exportValue);
    }
  }

  return validationInfo;
};

const validateTypesVersions = async (
  typesVersions: any,
  packageDir: string,
  issues: string[],
  warnings: string[]
): Promise<TypesVersionsValidationInfo[]> => {
  const validationInfo: TypesVersionsValidationInfo[] = [];

  for (const [version, paths] of Object.entries(typesVersions)) {
    if (typeof paths === 'object' && paths !== null) {
      const pathValidation: TypesVersionsValidationInfo = {
        version,
        paths: [],
      };

      for (const [pattern, mappings] of Object.entries(paths as Record<string, string[]>)) {
        const resolvedMappings: Array<{ file: string; exists: boolean }> = [];

        for (const mapping of mappings) {
          const resolvedPath = path.resolve(packageDir, mapping);
          const exists = await fileExists(resolvedPath);
          resolvedMappings.push({ file: mapping, exists });

          if (!exists) {
            issues.push(`typesVersions mapping for ${version}/${pattern} points to non-existent file: ${mapping}`);
          }
        }

        pathValidation.paths.push({
          pattern,
          mappings,
          resolved: resolvedMappings,
        });
      }

      validationInfo.push(pathValidation);
    }
  }

  return validationInfo;
};

const checkFileExists = async (
  field: string,
  filePath: string,
  packageDir: string
): Promise<FileResolutionInfo> => {
  const resolvedPath = path.resolve(packageDir, filePath);
  const exists = await fileExists(resolvedPath);
  
  let isDirectory = false;
  if (exists) {
    try {
      const stats = await fs.stat(resolvedPath);
      isDirectory = stats.isDirectory();
    } catch {
      // Ignore stat errors
    }
  }

  return {
    field,
    value: filePath,
    resolvedPath,
    exists,
    isDirectory,
  };
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};