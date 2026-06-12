import type { LocalIndexer as IndexerClient } from '../../indexer/local.js'
import type { InputField } from '../widgets/input.js'
import { matchCommands } from '../../commands/registry.js'

export class TabCompleter {
  private getIndexer: () => IndexerClient
  private input: InputField

  constructor(getIndexer: () => IndexerClient, input: InputField) {
    this.getIndexer = getIndexer
    this.input = input
  }

  async onTab(text: string, cursor: number): Promise<{ items: string[]; apply: (s: string) => void } | null> {
    // / command completion
    if (text.startsWith('/')) {
      const matches = matchCommands(text)
      if (matches.length === 0) return null
      return {
        items: matches.map(m => m.name),
        apply: (current) => {
          this.input.setValue(matches[0].name)
        },
      }
    }
    // @ file completion
    const at = text.lastIndexOf('@', cursor - 1)
    if (at >= 0) {
      const prefix = text.slice(at + 1, cursor)
      try {
        const indexer = this.getIndexer()
        if (!indexer) return null
        const r = await indexer.glob(`**/${prefix}*`)
        const items = r.files.slice(0, 10).map(f => f.replace(/.*\//, ''))
        return {
          items,
          apply: (current) => {
            const before = current.slice(0, at)
            const after = current.slice(cursor)
            const selected = r.files[0] ? `@${r.files[0]}` : `@${prefix}`
            this.input.setValue(before + selected + after, before.length + selected.length)
          },
        }
      } catch {
        return null
      }
    }
    return null
  }
}
