package main

var directiveSchema = map[string]interface{}{
	"type": "object",
	"properties": map[string]interface{}{
		"directives": map[string]interface{}{
			"type": "array",
			"items": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "string",
						"enum": []string{
							"indexer_ls",
							"indexer_read",
							"search",
							"execute",
							"write",
							"delete",
							"patch",
							"rollback",
							"glob",
							"find",
							"mv",
							"cp",
							"mkdir",
							"rmdir",
							"append",
							"read_multiple",
							"file_info",
							"diff",
							"ls_tree",
						},
					},
					"args": map[string]interface{}{
						"type":                 "object",
						"additionalProperties": false,
						"properties": map[string]interface{}{
							"path":        map[string]interface{}{"type": "string"},
							"content":     map[string]interface{}{"type": "string"},
							"command":     map[string]interface{}{"type": "string"},
							"pattern":     map[string]interface{}{"type": "string"},
							"base":        map[string]interface{}{"type": "string"},
							"name":        map[string]interface{}{"type": "string"},
							"root":        map[string]interface{}{"type": "string"},
							"from":        map[string]interface{}{"type": "string"},
							"to":          map[string]interface{}{"type": "string"},
							"target":      map[string]interface{}{"type": "string"},
							"replacement": map[string]interface{}{"type": "string"},
							"query":       map[string]interface{}{"type": "string"},
							"files":       map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
							"paths":       map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
						},
					},
				},
				"required": []string{"name", "args"},
			},
		},
	},
	"required": []string{"directives"},
}
