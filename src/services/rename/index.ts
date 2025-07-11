import { Project, Node, SyntaxKind, Identifier } from 'ts-morph';
import * as path from 'path';
import type { RenameOptions, RenameResult } from '../../types';

export const renameSymbol = async (options: RenameOptions): Promise<RenameResult> => {
  const { filePath, oldName, newName, type } = options;

  try {
    const project = new Project({
      tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
    });

    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      return {
        success: false,
        error: `Source file not found: ${filePath}`,
      };
    }

    const symbol = findSymbol(sourceFile, oldName, type);
    if (!symbol) {
      return {
        success: false,
        error: `Symbol "${oldName}" of type "${type}" not found in ${filePath}`,
      };
    }

    const referencedSymbols = project.getLanguageService().findReferences(symbol);
    const updatedFiles = new Set<string>();

    for (const referencedSymbol of referencedSymbols) {
      for (const reference of referencedSymbol.getReferences()) {
        const refSourceFile = reference.getSourceFile();
        const node = reference.getNode();
        
        if (Node.isIdentifier(node) && node.getText() === oldName) {
          node.replaceWithText(newName);
          updatedFiles.add(refSourceFile.getFilePath());
        }
      }
    }

    if (Node.isIdentifier(symbol)) {
      symbol.replaceWithText(newName);
      updatedFiles.add(sourceFile.getFilePath());
    }

    await project.save();

    return {
      success: true,
      updatedFiles: Array.from(updatedFiles),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const findSymbol = (
  sourceFile: any,
  name: string,
  type: RenameOptions['type']
): Identifier | undefined => {
  let foundNode: Identifier | undefined;

  sourceFile.forEachDescendant((node: Node) => {
    if (foundNode) return;

    switch (type) {
      case 'variable':
        if (Node.isVariableDeclaration(node)) {
          const nameNode = node.getNameNode();
          if (Node.isIdentifier(nameNode) && nameNode.getText() === name) {
            foundNode = nameNode;
          }
        }
        break;

      case 'function':
        if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)) {
          const nameNode = node.getNameNode();
          if (nameNode && nameNode.getText() === name) {
            foundNode = nameNode;
          }
        }
        if (Node.isVariableDeclaration(node)) {
          const initializer = node.getInitializer();
          if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
            const nameNode = node.getNameNode();
            if (Node.isIdentifier(nameNode) && nameNode.getText() === name) {
              foundNode = nameNode;
            }
          }
        }
        break;

      case 'type':
        if (Node.isTypeAliasDeclaration(node)) {
          const nameNode = node.getNameNode();
          if (nameNode.getText() === name) {
            foundNode = nameNode;
          }
        }
        break;

      case 'interface':
        if (Node.isInterfaceDeclaration(node)) {
          const nameNode = node.getNameNode();
          if (nameNode.getText() === name) {
            foundNode = nameNode;
          }
        }
        break;

      case 'class':
        if (Node.isClassDeclaration(node)) {
          const nameNode = node.getNameNode();
          if (nameNode && nameNode.getText() === name) {
            foundNode = nameNode;
          }
        }
        break;
    }
  });

  return foundNode;
};