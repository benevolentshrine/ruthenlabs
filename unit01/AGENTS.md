# Tool Guidance and Priority for Unit01 Agents

This document defines the available tools in the Unit01 architecture and sets clear guidelines on tool priority for agents modifying code or exploring the codebase.

## Available Tools

* **`run_command`**: Runs a shell command inside the sandboxed environment (subject to resource limits and network policy).
* **`read_file`**: Reads the contents of a file inside the workspace.
* **`write_file`**: Writes/creates a new file in the workspace.
* **`search_code`**: Searches the codebase index using BM25 keyword matching.
* **`patch_file`**: Replaces a single exact string occurrence in an existing file.
* **`patch_file_blocks`**: Performs multi-block search/replace edits using ORIGIN/UPDATED diff markers.
* **`list_dir`**: Lists files and directories at a given path directly from the filesystem.
* **`git_status`**: Returns parsed, structured git status of the workspace (staged, unstaged, branch, commits ahead/behind).
* **`diagnostics`**: Automatically runs project compilers or linters to check code correctness.
* **`move_file`**: Renames or moves a file or directory while keeping FTS indexing, shadow backups, and sandbox tracing consistent.

---

## Tool Priority Guidance

Agents must adhere to the following selection priority when editing, renaming, or creating files:

1. **`patch_file_blocks`**: Use this as the **default tool** for editing existing files. It allows multi-block search-and-replace using exact matching.
2. **`patch_file`**: Use this for simple, single, exact string replacements where a full block diff structure is unnecessary.
3. **`write_file`**: Use this **only when creating new files**.
4. **`move_file`**: Use this **always** when renaming or moving files. Never run `mv` or `cp` + `rm` commands in `run_command` to rename files, as this bypasses index updates, shadow backup rollback history, and sandbox write-before-run registrations.
5. **Never run `write_file` on an existing file**: To avoid wiping or corrupting existing codebase logic, agents must never overwrite existing files using `write_file`. Use `patch_file_blocks` or `patch_file` instead.

