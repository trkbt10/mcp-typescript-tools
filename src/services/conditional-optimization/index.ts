import { Project, SourceFile, Node, SyntaxKind, IfStatement, SwitchStatement } from 'ts-morph';
import * as path from 'path';
import type {
  ConditionalOptimizationOptions,
  ConditionalOptimizationResult,
  ConditionalOptimization,
} from '../../types';
import { cleanupProject } from '../../utils/project-cleanup';

export const optimizeConditionals = async (
  options: ConditionalOptimizationOptions
): Promise<ConditionalOptimizationResult> => {
  const {
    filePath,
    convertToSwitch = true,
    flattenNestedConditions = true,
    optimizeBoolean = true,
  } = options;
  let project: Project | undefined;

  try {
    project = new Project({
      useInMemoryFileSystem: false,
      compilerOptions: {
        allowJs: true,
        target: 99, // ESNext
      },
    });

    const sourceFile = project.addSourceFileAtPath(filePath);
    const optimizations: ConditionalOptimization[] = [];

    // Store original content for comparison
    const originalContent = sourceFile.getFullText();

    // 1. Convert if-else chains to switch statements
    if (convertToSwitch) {
      await convertIfElseToSwitch(sourceFile, optimizations);
    }

    // 2. Flatten nested conditions
    if (flattenNestedConditions) {
      await flattenNestedConditions(sourceFile, optimizations);
    }

    // 3. Optimize boolean expressions
    if (optimizeBoolean) {
      await optimizeBooleanExpressions(sourceFile, optimizations);
    }

    const optimizedCode = sourceFile.getFullText();
    const hasChanges = optimizedCode !== originalContent;

    if (hasChanges) {
      await sourceFile.save();
    }

    return {
      filePath,
      optimized: hasChanges,
      optimizations,
      optimizedCode: hasChanges ? optimizedCode : undefined,
    };
  } catch (error) {
    return {
      filePath,
      optimized: false,
      optimizations: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (project) {
      cleanupProject(project);
    }
  }
};

const convertIfElseToSwitch = async (
  sourceFile: SourceFile,
  optimizations: ConditionalOptimization[]
): Promise<void> => {
  const ifStatements = sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement);

  for (const ifStatement of ifStatements) {
    const switchCandidate = analyzeIfElseChain(ifStatement);
    
    if (switchCandidate && switchCandidate.cases.length >= 3) {
      const originalCode = ifStatement.getText();
      const lineNumber = sourceFile.getLineAndColumnAtPos(ifStatement.getStart()).line;
      
      const switchCode = generateSwitchStatement(switchCandidate);
      
      ifStatement.replaceWithText(switchCode);
      
      optimizations.push({
        type: 'if_to_switch',
        originalCode,
        optimizedCode: switchCode,
        reason: `Converted if-else chain with ${switchCandidate.cases.length} cases to switch statement`,
        lineNumber,
      });
    }
  }
};

const flattenNestedConditions = async (
  sourceFile: SourceFile,
  optimizations: ConditionalOptimization[]
): Promise<void> => {
  const ifStatements = sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement);

  for (const ifStatement of ifStatements) {
    const flattened = tryFlattenNestedIf(ifStatement);
    
    if (flattened) {
      const originalCode = ifStatement.getText();
      const lineNumber = sourceFile.getLineAndColumnAtPos(ifStatement.getStart()).line;
      
      ifStatement.replaceWithText(flattened);
      
      optimizations.push({
        type: 'flatten_nested',
        originalCode,
        optimizedCode: flattened,
        reason: 'Flattened nested if statement using early return',
        lineNumber,
      });
    }
  }
};

const optimizeBooleanExpressions = async (
  sourceFile: SourceFile,
  optimizations: ConditionalOptimization[]
): Promise<void> => {
  const ifStatements = sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement);

  for (const ifStatement of ifStatements) {
    const condition = ifStatement.getExpression();
    const optimizedCondition = optimizeBooleanExpression(condition.getText());
    
    if (optimizedCondition !== condition.getText()) {
      const originalCode = ifStatement.getText();
      const lineNumber = sourceFile.getLineAndColumnAtPos(ifStatement.getStart()).line;
      
      condition.replaceWithText(optimizedCondition);
      
      optimizations.push({
        type: 'boolean_optimization',
        originalCode,
        optimizedCode: ifStatement.getText(),
        reason: 'Simplified boolean expression',
        lineNumber,
      });
    }
  }
};

type SwitchCandidate = {
  variable: string;
  cases: Array<{
    value: string;
    body: string;
  }>;
  defaultCase?: string;
};

const analyzeIfElseChain = (ifStatement: IfStatement): SwitchCandidate | null => {
  const cases: SwitchCandidate['cases'] = [];
  let variable: string | null = null;
  let current: IfStatement | undefined = ifStatement;

  while (current) {
    const condition = current.getExpression();
    const caseInfo = extractSwitchCase(condition.getText());
    
    if (!caseInfo) {
      return null; // Not a simple equality check
    }
    
    if (variable === null) {
      variable = caseInfo.variable;
    } else if (variable !== caseInfo.variable) {
      return null; // Different variables, can't convert to switch
    }
    
    const body = current.getThenStatement().getText();
    cases.push({
      value: caseInfo.value,
      body: body.startsWith('{') ? body.slice(1, -1).trim() : body,
    });
    
    const elseStatement = current.getElseStatement();
    if (Node.isIfStatement(elseStatement)) {
      current = elseStatement;
    } else {
      // Final else clause
      if (elseStatement) {
        const defaultBody = elseStatement.getText();
        return {
          variable,
          cases,
          defaultCase: defaultBody.startsWith('{') ? defaultBody.slice(1, -1).trim() : defaultBody,
        };
      }
      break;
    }
  }
  
  return variable ? { variable, cases } : null;
};

const extractSwitchCase = (condition: string): { variable: string; value: string } | null => {
  // Match patterns like: variable === 'value' or variable == 'value'
  const equalityMatch = condition.match(/(\w+)\s*===?\s*['"`]([^'"`]+)['"`]/);
  if (equalityMatch) {
    return {
      variable: equalityMatch[1],
      value: equalityMatch[2],
    };
  }
  
  // Match patterns like: variable === value (without quotes)
  const varMatch = condition.match(/(\w+)\s*===?\s*(\w+)/);
  if (varMatch) {
    return {
      variable: varMatch[1],
      value: varMatch[2],
    };
  }
  
  return null;
};

const generateSwitchStatement = (candidate: SwitchCandidate): string => {
  let switchCode = `switch (${candidate.variable}) {\n`;
  
  for (const caseItem of candidate.cases) {
    switchCode += `  case '${caseItem.value}':\n`;
    switchCode += `    ${caseItem.body}\n`;
    if (!caseItem.body.includes('return') && !caseItem.body.includes('break')) {
      switchCode += '    break;\n';
    }
  }
  
  if (candidate.defaultCase) {
    switchCode += '  default:\n';
    switchCode += `    ${candidate.defaultCase}\n`;
  }
  
  switchCode += '}';
  return switchCode;
};

const tryFlattenNestedIf = (ifStatement: IfStatement): string | null => {
  const thenStatement = ifStatement.getThenStatement();
  const elseStatement = ifStatement.getElseStatement();
  
  // Look for pattern: if (condition) { if (nested) { ... } }
  if (Node.isBlock(thenStatement) && !elseStatement) {
    const statements = thenStatement.getStatements();
    if (statements.length === 1 && Node.isIfStatement(statements[0])) {
      const nestedIf = statements[0];
      const outerCondition = ifStatement.getExpression().getText();
      const nestedCondition = nestedIf.getExpression().getText();
      const nestedBody = nestedIf.getThenStatement().getText();
      
      // Combine conditions with &&
      return `if (${outerCondition} && ${nestedCondition}) ${nestedBody}`;
    }
  }
  
  return null;
};

const optimizeBooleanExpression = (expression: string): string => {
  let optimized = expression;
  
  // Remove double negations: !!value -> Boolean(value)
  optimized = optimized.replace(/!!\s*(\w+)/g, 'Boolean($1)');
  
  // Simplify boolean comparisons: value === true -> value
  optimized = optimized.replace(/(\w+)\s*===\s*true/g, '$1');
  optimized = optimized.replace(/(\w+)\s*===\s*false/g, '!$1');
  
  // Simplify redundant conditions: value === true && otherCondition -> value && otherCondition
  optimized = optimized.replace(/(\w+)\s*===\s*true\s*&&/g, '$1 &&');
  
  return optimized;
};