export type MenuType = 'commands' | 'model' | 'mode' | 'resume' | 'help'

export interface HelpMenuItem {
  category?: string
  name?: string
  cmd?: string
  shortcut?: string
}
