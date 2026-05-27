use serde_json::Value;

pub fn directive_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "directives": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "enum": [
                                "indexer_ls", "indexer_read", "search", "execute",
                                "write", "delete", "patch", "rollback",
                                "glob", "find", "mv", "cp", "mkdir", "rmdir",
                                "append", "read_multiple", "file_info", "diff", "ls_tree"
                            ]
                        },
                        "args": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "path": { "type": "string" },
                                "content": { "type": "string" },
                                "command": { "type": "string" },
                                "pattern": { "type": "string" },
                                "base": { "type": "string" },
                                "name": { "type": "string" },
                                "root": { "type": "string" },
                                "from": { "type": "string" },
                                "to": { "type": "string" },
                                "target": { "type": "string" },
                                "replacement": { "type": "string" },
                                "query": { "type": "string" },
                                "files": { "type": "array", "items": { "type": "string" } },
                                "paths": { "type": "array", "items": { "type": "string" } }
                            }
                        }
                    },
                    "required": ["name", "args"]
                }
            }
        },
        "required": ["directives"]
    })
}
