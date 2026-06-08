declare module 'diff' {
  export interface Change {
    value: string
    added?: boolean
    removed?: boolean
  }
  export function diffLines(a: string, b: string): Change[]
  export function diffChars(a: string, b: string): Change[]
}
