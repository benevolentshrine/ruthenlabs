import type { ToolRunner, ToolContext } from './types.js'

export class ReadFileRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    const path = args.path as string
    const start = args.start_line as number | undefined
    const end = args.end_line as number | undefined
    
    const r = await ctx.indexer.read(path)
    const lines = r.content.split('\n')
    const totalLines = lines.length
    
    let startIdx = 0
    let endIdx = Math.min(200, totalLines)
    
    if (start !== undefined) {
      startIdx = Math.max(0, start - 1)
    }
    if (end !== undefined) {
      endIdx = Math.min(totalLines, end)
    } else if (start !== undefined) {
      endIdx = Math.min(totalLines, startIdx + 200)
    }
    
    if (endIdx - startIdx > 200) {
      endIdx = startIdx + 200
    }
    
    const sliced = lines.slice(startIdx, endIdx).join('\n')
    let suffix = ''
    if (endIdx < totalLines) {
      suffix = `\n\n[... Truncated: showing lines ${startIdx + 1}-${endIdx} of ${totalLines} total lines. Use start_line/end_line to read specific ranges ...]`
    }
    return sliced + suffix
  }
}

export class WriteFileRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    await ctx.indexer.write(args.path as string, args.content as string)
    return `Wrote ${(args.content as string).length} bytes to ${args.path}. Shadow backup created.`
  }
}

export class PatchFileRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    const path = args.path as string
    const target = args.target as string
    const replacement = args.replacement as string
    const r = await ctx.indexer.read(path)
    const original = r.content
    
    const firstIdx = original.indexOf(target)
    if (firstIdx === -1) {
      return `Error: target text not found in ${path}. The target text must match EXACTLY.`
    }
    const lastIdx = original.lastIndexOf(target)
    if (firstIdx !== lastIdx) {
      return `Error: target text matches multiple times in ${path}. The target text must be unique to avoid patching the wrong location.`
    }
    
    await ctx.indexer.patch(path, target, replacement)
    return `Patched ${path}. Shadow backup created.`
  }
}

export function applySearchReplaceBlocks(content: string, blocksStr: string): string {
  const lines = blocksStr.split('\n')
  const blocks: { search: string; replace: string }[] = []
  
  let currentSearch: string[] = []
  let currentReplace: string[] = []
  let inSearch = false
  let inReplace = false
  
  for (const line of lines) {
    if (line.startsWith('<<<<<<< SEARCH')) {
      inSearch = true
      inReplace = false
      currentSearch = []
    } else if (line.startsWith('=======')) {
      inSearch = false
      inReplace = true
      currentReplace = []
    } else if (line.startsWith('>>>>>>> REPLACE')) {
      inSearch = false
      inReplace = false
      blocks.push({
        search: currentSearch.join('\n'),
        replace: currentReplace.join('\n'),
      })
    } else {
      if (inSearch) {
        currentSearch.push(line)
      } else if (inReplace) {
        currentReplace.push(line)
      }
    }
  }
  
  if (blocks.length === 0) {
    throw new Error("No valid SEARCH/REPLACE blocks found in the input. Format must use <<<<<<< SEARCH, =======, and >>>>>>> REPLACE.")
  }
  
  let updated = content
  for (const block of blocks) {
    if (!block.search.trim()) {
      throw new Error("Empty SEARCH block is not allowed.")
    }
    
    const index = updated.indexOf(block.search)
    if (index === -1) {
      const normalizedSearch = block.search.replace(/\r\n/g, '\n')
      const normalizedContent = updated.replace(/\r\n/g, '\n')
      const normIndex = normalizedContent.indexOf(normalizedSearch)
      
      if (normIndex === -1) {
        throw new Error(`Could not find the SEARCH block in the file. Indentation and whitespace must match exactly:\n${block.search}`)
      }
      
      const firstIndex = normalizedContent.indexOf(normalizedSearch)
      const lastIndex = normalizedContent.lastIndexOf(normalizedSearch)
      if (firstIndex !== lastIndex) {
        throw new Error("The SEARCH block matches multiple places in the file. Please provide more context lines to make it unique.")
      }
      
      updated = normalizedContent.slice(0, normIndex) + block.replace + normalizedContent.slice(normIndex + normalizedSearch.length)
    } else {
      const lastIndex = updated.lastIndexOf(block.search)
      if (index !== lastIndex) {
        throw new Error("The SEARCH block matches multiple places in the file. Please provide more context lines to make it unique.")
      }
      updated = updated.slice(0, index) + block.replace + updated.slice(index + block.search.length)
    }
  }
  
  return updated
}

export class PatchFileBlocksRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    const path = args.path as string
    const blocks = args.blocks as string
    const r = await ctx.indexer.read(path)
    const original = r.content
    const updated = applySearchReplaceBlocks(original, blocks)
    await ctx.indexer.write(path, updated)
    return `Patched ${path} using SEARCH/REPLACE blocks. Shadow backup created.`
  }
}
