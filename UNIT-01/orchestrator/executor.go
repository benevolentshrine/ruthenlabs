package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unit01/clients"
)

// mcpMgr is set once at startup by main() for MCP tool routing.
var mcpMgr *MCPManager

// Tool execution — routes directives to sandbox (exec) or indexer (file ops).
// No direct filesystem access. Pure routing.
func ExecuteTool(name string, args map[string]any, ws *Workspace) string {
	if ws.Active {
		pathKeys := map[string]bool{"path": true, "cwd": true, "base": true, "root": true, "from": true, "to": true}
		for k, v := range args {
			if s, ok := v.(string); ok && !filepath.IsAbs(s) && pathKeys[k] {
				args[k] = filepath.Join(ws.Path, s)
			}
		}
	}

	switch name {
	case "set_workspace":
		path, _ := args["path"].(string)
		if path == "" {
			return "❌ ERROR: Missing 'path' parameter for set_workspace."
		}
		sessionID, err := ws.Set(path)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Failed to set workspace: %v", err)
		}
		return fmt.Sprintf("✅ Workspace set to %s. Session ID: %s.", path, sessionID)

	case "indexer_ls", "list_files":
		path, ok := args["path"].(string)
		if !ok {
			path, _ = args["param"].(string)
		}
		client := clients.NewIndexerClient()
		result, callErr := client.List(path)
		if callErr != nil {
			entries, osErr := os.ReadDir(path)
			if osErr != nil {
				return fmt.Sprintf("❌ ERROR: %v", osErr)
			}
			var stdout string
			stdout = fmt.Sprintf("Contents of %s:\n", path)
			for _, e := range entries {
				prefix := "  f "
				if e.IsDir() {
					prefix = "  d "
				}
				stdout += fmt.Sprintf("%s %s\n", prefix, e.Name())
			}
			return stdout
		}
		var stdout string
		stdout = fmt.Sprintf("Contents of %s:\n", path)
		for _, e := range result.Entries {
			prefix := "  f "
			if e.Type == "dir" {
				prefix = "  d "
			}
			stdout += fmt.Sprintf("%s %s\n", prefix, e.Name)
		}
		return stdout

	case "indexer_read":
		path, _ := args["path"].(string)
		client := clients.NewIndexerClient()
		stdout, err := client.Read(path)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: %v", err)
		}
		return stdout

	case "search":
		query, _ := args["query"].(string)
		client := clients.NewIndexerClient()
		records, err := client.Search(query)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: %v", err)
		}
		if len(records) == 0 {
			return "🔍 No results found."
		}
		var stdout string
		stdout = fmt.Sprintf("🔍 Search results for '%s':\n", query)
		for _, r := range records {
			stdout += fmt.Sprintf("  %s  (%s, %db)\n", r.Path, r.Language, r.Size)
		}
		return stdout

	case "sandbox_exec", "execute":
		cmd, _ := args["command"].(string)
		client := clients.NewSandboxClient()
		stdout, err := client.Execute(cmd)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: %v", err)
		}
		return stdout

	case "sandbox_write", "write":
		path, _ := args["path"].(string)
		content, _ := args["content"].(string)
		if content == "" {
			// Model-specific fallbacks: some models (DeepSeek, etc.) use
			// "target" or other keys instead of "content" for file content.
			for _, key := range []string{"target", "content_data", "data", "text", "body", "html", "code"} {
				if c, ok := args[key].(string); ok && c != "" {
					content = c
					break
				}
			}
		}
		content = strings.ReplaceAll(content, "\\n", "\n")
		client := clients.NewIndexerClient()
		err := client.Write(path, content)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Write failed: %v", err)
		}
		return fmt.Sprintf("✅ SUCCESS: File written at %s", path)

	case "sandbox_patch", "patch":
		path, _ := args["path"].(string)
		target, _ := args["target"].(string)
		replacement, _ := args["replacement"].(string)
		target = strings.ReplaceAll(target, "\\n", "\n")
		replacement = strings.ReplaceAll(replacement, "\\n", "\n")
		client := clients.NewIndexerClient()
		stdout, err := client.Patch(path, target, replacement)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Patch failed: %v", err)
		}
		return fmt.Sprintf("✅ SUCCESS: %s", stdout)

	case "sandbox_delete", "delete":
		path, _ := args["path"].(string)
		client := clients.NewIndexerClient()
		stdout, err := client.Delete(path)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Delete failed: %v", err)
		}
		return fmt.Sprintf("✅ SUCCESS: %s", stdout)

	case "sandbox_rollback", "rollback":
		client := clients.NewIndexerClient()
		stdout, err := client.Rollback()
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Rollback failed: %v", err)
		}
		return fmt.Sprintf("✅ SUCCESS: %s", stdout)

	case "glob":
		pattern, _ := args["pattern"].(string)
		base, _ := args["base"].(string)
		if base == "" && ws.Active {
			base = ws.Path
		}
		client := clients.NewIndexerClient()
		files, err := client.Glob(pattern, base)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Glob failed: %v", err)
		}
		if len(files) == 0 {
			return fmt.Sprintf("📁 No files match '%s'", pattern)
		}
		out := fmt.Sprintf("📁 Glob '%s' (%d files):\n", pattern, len(files))
		for _, f := range files {
			out += fmt.Sprintf("  %s\n", f)
		}
		return out

	case "find":
		name, _ := args["name"].(string)
		root, _ := args["root"].(string)
		if root == "" && ws.Active {
			root = ws.Path
		}
		client := clients.NewIndexerClient()
		files, err := client.Find(name, root)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Find failed: %v", err)
		}
		if len(files) == 0 {
			return fmt.Sprintf("🔍 No files match name '%s'", name)
		}
		out := fmt.Sprintf("🔍 Found '%s' (%d files):\n", name, len(files))
		for _, f := range files {
			out += fmt.Sprintf("  %s\n", f)
		}
		return out

	case "mv":
		from, _ := args["from"].(string)
		to, _ := args["to"].(string)
		client := clients.NewIndexerClient()
		status, err := client.Mv(from, to)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Move failed: %v", err)
		}
		return fmt.Sprintf("✅ %s", status)

	case "cp":
		from, _ := args["from"].(string)
		to, _ := args["to"].(string)
		client := clients.NewIndexerClient()
		status, err := client.Cp(from, to)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Copy failed: %v", err)
		}
		return fmt.Sprintf("✅ %s", status)

	case "mkdir":
		path, _ := args["path"].(string)
		client := clients.NewIndexerClient()
		status, err := client.Mkdir(path)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Mkdir failed: %v", err)
		}
		return fmt.Sprintf("✅ %s", status)

	case "rmdir":
		path, _ := args["path"].(string)
		client := clients.NewIndexerClient()
		status, err := client.Rmdir(path)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Rmdir failed: %v", err)
		}
		return fmt.Sprintf("✅ %s", status)

	case "append":
		path, _ := args["path"].(string)
		content, _ := args["content"].(string)
		if content == "" {
			if c, ok := args["data"].(string); ok && c != "" {
				content = c
			} else if c, ok := args["text"].(string); ok && c != "" {
				content = c
			}
		}
		client := clients.NewIndexerClient()
		status, err := client.Append(path, content)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Append failed: %v", err)
		}
		return fmt.Sprintf("✅ %s", status)

	case "read_multiple":
		pathsRaw, ok := args["paths"].([]any)
		if !ok {
			return "❌ ERROR: 'paths' must be an array of strings"
		}
		paths := make([]string, len(pathsRaw))
		for i, p := range pathsRaw {
			paths[i], _ = p.(string)
		}
		client := clients.NewIndexerClient()
		res, err := client.ReadMultiple(paths)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: ReadMultiple failed: %v", err)
		}
		out := fmt.Sprintf("📖 Read %d files:\n", len(res.Files))
		for p, c := range res.Files {
			out += fmt.Sprintf("\n─── %s ───\n%s\n", p, c)
		}
		return out

	case "file_info":
		path, _ := args["path"].(string)
		client := clients.NewIndexerClient()
		info, err := client.FileInfo(path)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: FileInfo failed: %v", err)
		}
		return fmt.Sprintf("📄 %s\n  Size: %d bytes\n  Dir: %v\n  Perms: %o\n  Modified: %s",
			path, info.Size, info.IsDir, info.Permissions, info.Modified)

	case "diff":
		filesRaw, ok := args["files"].([]any)
		if !ok {
			return "❌ ERROR: 'files' must be an array of strings"
		}
		files := make([]string, len(filesRaw))
		for i, f := range filesRaw {
			files[i], _ = f.(string)
		}
		client := clients.NewIndexerClient()
		res, err := client.Diff(files)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: Diff failed: %v", err)
		}
		out := fmt.Sprintf("📊 Diff (%s):\n", strings.Join(res.Files, " ↔ "))
		for _, l := range res.Lines {
			mark := " "
			switch l.Type {
			case "added":
				mark = "+"
			case "removed":
				mark = "-"
			}
			out += fmt.Sprintf("  %s %4d  %s\n", mark, l.Number, l.Text)
		}
		return out

	case "ls_tree":
		root, _ := args["root"].(string)
		if root == "" && ws.Active {
			root = ws.Path
		}
		client := clients.NewIndexerClient()
		res, err := client.LsTree(root)
		if err != nil {
			return fmt.Sprintf("❌ ERROR: LsTree failed: %v", err)
		}
		var renderTree func(entries []clients.TreeEntry, indent string) string
		renderTree = func(entries []clients.TreeEntry, indent string) string {
			var out string
			for _, e := range entries {
				if e.Type == "dir" {
					out += fmt.Sprintf("%s📁 %s/\n", indent, e.Name)
					out += renderTree(e.Children, indent+"  ")
				} else {
					out += fmt.Sprintf("%s📄 %s\n", indent, e.Name)
				}
			}
			return out
		}
		return fmt.Sprintf("🌳 %s\n%s", res.Root, renderTree(res.Tree, ""))

	default:
		if mcpMgr != nil && mcpMgr.HasTool(name) {
			return mcpMgr.ExecuteMCPTool(name, args)
		}
		return fmt.Sprintf("⚠️ Tool [%s] not recognized.", name)
	}
}
