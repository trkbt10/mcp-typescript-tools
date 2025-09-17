import { readFile, writeFile } from 'fs/promises';

export type CommentOrganizationOptions = {
  deduplicateComments?: boolean;
  moveToTop?: boolean;
  preserveInlineComments?: boolean;
  removeEmptyComments?: boolean;
};

export type CommentOrganizationResult = {
  success: boolean;
  message: string;
  changes: {
    removed: string[];
    moved: string[];
    deduplicated: string[];
  };
  error?: string;
};

export const organizeComments = async (
  filePath: string,
  options: CommentOrganizationOptions = {}
): Promise<CommentOrganizationResult> => {
  const {
    deduplicateComments = true,
    moveToTop = true,
    preserveInlineComments = true,
    removeEmptyComments = true,
  } = options;

  try {
    const content = await readFile(filePath, 'utf-8');
    
    const result: CommentOrganizationResult = {
      success: true,
      message: 'Comments organized successfully',
      changes: {
        removed: [],
        moved: [],
        deduplicated: []
      }
    };

    const processedContent = processFileContent(content, options, result);
    
    await writeFile(filePath, processedContent, 'utf-8');
    
    return result;
  } catch (error) {
    return {
      success: false,
      message: 'Failed to organize comments',
      changes: {
        removed: [],
        moved: [],
        deduplicated: []
      },
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const processFileContent = (
  content: string,
  options: CommentOrganizationOptions,
  result: CommentOrganizationResult
): string => {
  const lines = content.split('\n');
  
  // Extract all comment blocks
  const commentBlocks: Array<{
    text: string;
    startLine: number;
    endLine: number;
    type: 'jsdoc' | 'multi' | 'single';
    isEmpty: boolean;
  }> = [];
  
  let inMultiLineComment = false;
  let currentCommentStart = -1;
  let currentCommentLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    
    if (trimmed.startsWith('/**')) {
      inMultiLineComment = true;
      currentCommentStart = i;
      currentCommentLines = [line];
      
      if (trimmed.endsWith('*/')) {
        // Single line JSDoc
        const commentText = currentCommentLines.join('\n');
        commentBlocks.push({
          text: commentText,
          startLine: currentCommentStart,
          endLine: i,
          type: 'jsdoc',
          isEmpty: isEmptyComment(commentText)
        });
        inMultiLineComment = false;
        currentCommentLines = [];
      }
    } else if (trimmed.startsWith('/*')) {
      inMultiLineComment = true;
      currentCommentStart = i;
      currentCommentLines = [line];
      
      if (trimmed.endsWith('*/')) {
        // Single line multi-line comment
        const commentText = currentCommentLines.join('\n');
        commentBlocks.push({
          text: commentText,
          startLine: currentCommentStart,
          endLine: i,
          type: 'multi',
          isEmpty: isEmptyComment(commentText)
        });
        inMultiLineComment = false;
        currentCommentLines = [];
      }
    } else if (inMultiLineComment) {
      currentCommentLines.push(line);
      
      if (trimmed.endsWith('*/')) {
        const commentText = currentCommentLines.join('\n');
        const isJSDoc = currentCommentLines[0]?.trim().startsWith('/**');
        commentBlocks.push({
          text: commentText,
          startLine: currentCommentStart,
          endLine: i,
          type: isJSDoc ? 'jsdoc' : 'multi',
          isEmpty: isEmptyComment(commentText)
        });
        inMultiLineComment = false;
        currentCommentLines = [];
      }
    } else if (trimmed.startsWith('//')) {
      // Single line comment
      commentBlocks.push({
        text: line,
        startLine: i,
        endLine: i,
        type: 'single',
        isEmpty: isEmptyComment(line)
      });
    }
  }
  
  
  let processedContent = content;
  
  if (options.removeEmptyComments) {
    const emptyComments = commentBlocks.filter(c => c.isEmpty);
    emptyComments.forEach(comment => {
      result.changes.removed.push(comment.text);
    });
  }
  
  if (options.moveToTop) {
    const fileComments = commentBlocks
      .filter(c => c.type === 'jsdoc' || c.type === 'multi')
      .filter(c => !options.removeEmptyComments || !c.isEmpty);
    
    if (fileComments.length > 0) {
      // Find duplicates and unique comments
      const uniqueComments = new Map<string, typeof fileComments[0]>();
      
      fileComments.forEach(comment => {
        const normalized = normalizeCommentText(comment.text);
        if (!uniqueComments.has(normalized)) {
          uniqueComments.set(normalized, comment);
        } else if (options.deduplicateComments) {
          result.changes.deduplicated.push(comment.text);
        }
      });
      
      // Remove all existing file-level comments
      let newLines = [...lines];
      const sortedComments = [...fileComments].sort((a, b) => b.startLine - a.startLine);
      
      sortedComments.forEach(comment => {
        for (let i = comment.endLine; i >= comment.startLine; i--) {
          newLines.splice(i, 1);
        }
        // Remove empty line after comment if it exists
        if (comment.startLine < newLines.length && newLines[comment.startLine]?.trim() === '') {
          newLines.splice(comment.startLine, 1);
        }
        result.changes.moved.push(comment.text);
      });
      
      // Create consolidated comment at the top
      let commentsToUse = fileComments;
      if (options.deduplicateComments) {
        commentsToUse = Array.from(uniqueComments.values());
      }
      
      const consolidatedComment = createConsolidatedComment(commentsToUse);
      
      if (consolidatedComment) {
        // Find first non-empty line that's not a comment
        let insertIndex = 0;
        while (insertIndex < newLines.length) {
          const currentLine = newLines[insertIndex];
          if (currentLine && currentLine.trim() !== '' && !currentLine.trim().startsWith('//')) {
            break;
          }
          insertIndex++;
        }
        
        newLines.splice(insertIndex, 0, consolidatedComment, '');
      }
      
      processedContent = newLines.join('\n');
    }
  }
  
  return processedContent;
};

const isEmptyComment = (text: string): boolean => {
  const cleaned = text
    .replace(/^\/\*\*?|\*\/|\/\/|^\s*\*\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length === 0;
};

const normalizeCommentText = (text: string): string => {
  return text
    .replace(/^\/\*\*?|\*\/|\/\/|^\s*\*\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const createConsolidatedComment = (
  comments: Array<{ text: string; type: string }>
): string => {
  const contents = comments
    .map(comment => extractCommentContent(comment.text))
    .filter(content => content.length > 0);
  
  if (contents.length === 0) return '';
  
  if (contents.length === 1) {
    return `/**\n * ${contents[0]}\n */`;
  }
  
  const combinedContent = contents.join('\n * ');
  return `/**\n * ${combinedContent}\n */`;
};

const extractCommentContent = (commentText: string): string => {
  return commentText
    .replace(/^\/\*\*?|\*\/$/g, '')
    .replace(/^\s*\*\s?/gm, '')
    .trim();
};