import type { AppContext } from '../../app.js'
import type { InputField } from '../widgets/input.js'
import type { ModelInfo } from '../../types.js'
import type { MenuType, HelpMenuItem } from './types.js'
import { matchCommands } from '../../commands/registry.js'
import { listSessions } from '../../config/store.js'

export const HELP_ITEMS: HelpMenuItem[] = [
  { category: 'Suggested' },
  { name: 'Switch session', cmd: '/resume', shortcut: '/resume' },
  { name: 'Switch model', cmd: '/model', shortcut: '/model' },
  { category: 'Session' },
  { name: 'Switch session', cmd: '/resume', shortcut: '/resume' },
  { name: 'New session', cmd: '/new', shortcut: '/new' },
  { name: 'Save session', cmd: '/save', shortcut: '/save' },
  { name: 'Clear messages', cmd: '/clear', shortcut: '/clear' },
  { category: 'Agent' },
  { name: 'Switch model', cmd: '/model', shortcut: '/model' },
  { name: 'Cycle mode', cmd: '/mode', shortcut: 'shift+tab' },
  { name: 'Toggle thinking', cmd: '/thinking', shortcut: '/thinking' },
  { name: 'Rebuild index', cmd: '/index', shortcut: '/index' },
  { name: 'Find dependencies', cmd: '/deps', shortcut: '/deps' },
  { name: 'Impact analysis', cmd: '/impact', shortcut: '/impact' },
  { category: 'System' },
  { name: 'Doctor (status)', cmd: '/doctor', shortcut: '/doctor' },
  { name: 'Rollback writes', cmd: '/undo', shortcut: '/undo' },
  { name: 'List backups', cmd: '/shadow', shortcut: '/shadow' },
  { name: 'Compress history', cmd: '/compress', shortcut: '/compress' },
  { name: 'Exit app', cmd: '/exit', shortcut: '/exit' }
]

export function getFilteredHelpItems(q: string): HelpMenuItem[] {
  if (!q) return HELP_ITEMS
  
  const filtered: HelpMenuItem[] = []
  for (let i = 0; i < HELP_ITEMS.length; i++) {
    const item = HELP_ITEMS[i]
    if (item.category !== undefined) {
      // Look ahead to see if any items in this category match the query
      let hasMatch = false
      for (let j = i + 1; j < HELP_ITEMS.length; j++) {
        const next = HELP_ITEMS[j]
        if (next.category !== undefined) break
        if (next.name?.toLowerCase().includes(q) || next.cmd?.toLowerCase().includes(q)) {
          hasMatch = true
          break
        }
      }
      if (hasMatch) {
        filtered.push(item)
      }
    } else {
      if (item.name?.toLowerCase().includes(q) || item.cmd?.toLowerCase().includes(q)) {
        filtered.push(item)
      }
    }
  }
  return filtered
}

export class MenuController {
  public activeMenu: MenuType | null = null
  public menuIndex = 0
  public menuOptions: any[] = []

  isActive(): boolean {
    return this.activeMenu !== null
  }

  clear() {
    this.activeMenu = null
    this.menuIndex = 0
    this.menuOptions = []
  }

  onInputChange(text: string, allModels: ModelInfo[]) {
    if (!text.startsWith('/')) {
      this.clear()
      return
    }
    
    const firstSpace = text.indexOf(' ')
    if (firstSpace === -1) {
      this.activeMenu = 'commands'
      this.menuOptions = matchCommands(text)
      if (this.menuIndex >= this.menuOptions.length) {
        this.menuIndex = 0
      }
    } else {
      const cmd = text.slice(0, firstSpace)
      if (cmd === '/model') {
        this.activeMenu = 'model'
        const q = text.slice(firstSpace + 1).toLowerCase()
        this.menuOptions = allModels.filter(m => m.name.toLowerCase().includes(q))
        if (this.menuIndex >= this.menuOptions.length) {
          this.menuIndex = 0
        }
      } else if (cmd === '/mode') {
        this.activeMenu = 'mode'
        const q = text.slice(firstSpace + 1).toLowerCase()
        const allModes = ['plan', 'ask', 'auto-edit', 'auto', 'yolo']
        this.menuOptions = allModes.filter(m => m.includes(q))
        if (this.menuIndex >= this.menuOptions.length) {
          this.menuIndex = 0
        }
      } else if (cmd === '/resume' || cmd === '/session' || cmd === '/sessions') {
        this.activeMenu = 'resume'
        const q = text.slice(firstSpace + 1).toLowerCase()
        this.menuOptions = listSessions().filter(s => s.name.toLowerCase().includes(q))
        if (this.menuIndex >= this.menuOptions.length) {
          this.menuIndex = 0
        }
      } else if (cmd === '/help') {
        this.activeMenu = 'help'
        const q = text.slice(firstSpace + 1).toLowerCase()
        this.menuOptions = getFilteredHelpItems(q)
        this.menuIndex = this.menuOptions.findIndex(item => item.category === undefined)
        if (this.menuIndex === -1) this.menuIndex = 0
      } else {
        this.clear()
      }
    }
  }

  async handleKey(key: any, ctx: AppContext, input: InputField, allModels: ModelInfo[], onSlashCommand: (cmd: string) => Promise<boolean>): Promise<boolean> {
    if (!this.isActive() || this.menuOptions.length === 0) return false

    if (key.name === 'up') {
      if (this.activeMenu === 'help') {
        // Skip headers (items with category property)
        let idx = this.menuIndex
        do {
          idx = (idx - 1 + this.menuOptions.length) % this.menuOptions.length
        } while (this.menuOptions[idx].category !== undefined && idx !== this.menuIndex)
        this.menuIndex = idx
      } else {
        this.menuIndex = (this.menuIndex - 1 + this.menuOptions.length) % this.menuOptions.length
      }
      return true
    }

    if (key.name === 'down') {
      if (this.activeMenu === 'help') {
        let idx = this.menuIndex
        do {
          idx = (idx + 1) % this.menuOptions.length
        } while (this.menuOptions[idx].category !== undefined && idx !== this.menuIndex)
        this.menuIndex = idx
      } else {
        this.menuIndex = (this.menuIndex + 1) % this.menuOptions.length
      }
      return true
    }

    if (key.name === 'enter') {
      await this.selectMenuItem(ctx, input, allModels, onSlashCommand)
      return true
    }

    if (key.name === 'escape') {
      if (this.activeMenu !== 'commands') {
        this.activeMenu = 'commands'
        this.menuOptions = matchCommands('/')
        this.menuIndex = 0
        input.setValue('/')
      } else {
        this.clear()
        input.setValue('')
      }
      return true
    }

    return false
  }

  private async selectMenuItem(ctx: AppContext, input: InputField, allModels: ModelInfo[], onSlashCommand: (cmd: string) => Promise<boolean>) {
    if (!this.activeMenu || this.menuOptions.length === 0) return
    
    const option = this.menuOptions[this.menuIndex]
    
    if (this.activeMenu === 'commands') {
      const cmd = option.name
      if (cmd === '/model') {
        input.setValue('/model ')
        this.activeMenu = 'model'
        this.menuOptions = allModels
        this.menuIndex = 0
      } else if (cmd === '/mode') {
        input.setValue('/mode ')
        this.activeMenu = 'mode'
        this.menuOptions = ['plan', 'ask', 'auto-edit', 'auto', 'yolo']
        this.menuIndex = 0
      } else if (cmd === '/resume' || cmd === '/session' || cmd === '/sessions') {
        input.setValue('/resume ')
        this.activeMenu = 'resume'
        this.menuOptions = listSessions()
        this.menuIndex = 0
      } else if (cmd === '/help') {
        input.setValue('/help ')
        this.activeMenu = 'help'
        this.menuOptions = HELP_ITEMS
        this.menuIndex = this.menuOptions.findIndex(item => item.category === undefined)
        if (this.menuIndex === -1) this.menuIndex = 0
      } else {
        input.clear()
        this.clear()
        await onSlashCommand(cmd)
      }
    } else if (this.activeMenu === 'model') {
      const modelName = typeof option === 'string' ? option : option.name
      input.clear()
      this.clear()
      await ctx.enterChatWithModel(modelName)
    } else if (this.activeMenu === 'mode') {
      input.clear()
      this.clear()
      ctx.setMode(option)
      ctx.notify('success', `Mode → ${option}`)
    } else if (this.activeMenu === 'resume') {
      input.clear()
      this.clear()
      const sessionName = option.name
      if (ctx.resumeSession(sessionName)) {
        ctx.notify('success', `Resumed session: ${sessionName}`)
      } else {
        ctx.notify('error', `Session not found: ${sessionName}`)
      }
    } else if (this.activeMenu === 'help') {
      const cmd = option.cmd
      if (cmd === '/model') {
        input.setValue('/model ')
        this.activeMenu = 'model'
        this.menuOptions = allModels
        this.menuIndex = 0
      } else if (cmd === '/mode') {
        input.setValue('/mode ')
        this.activeMenu = 'mode'
        this.menuOptions = ['plan', 'ask', 'auto-edit', 'auto', 'yolo']
        this.menuIndex = 0
      } else if (cmd === '/resume' || cmd === '/session' || cmd === '/sessions') {
        input.setValue('/resume ')
        this.activeMenu = 'resume'
        this.menuOptions = listSessions()
        this.menuIndex = 0
      } else if (cmd === '/help') {
        input.setValue('/help ')
        this.activeMenu = 'help'
        this.menuOptions = HELP_ITEMS
        this.menuIndex = this.menuOptions.findIndex(item => item.category === undefined)
        if (this.menuIndex === -1) this.menuIndex = 0
      } else {
        input.clear()
        this.clear()
        await onSlashCommand(cmd)
      }
    }
  }
}
