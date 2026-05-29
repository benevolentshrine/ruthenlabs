use crate::types::Directive;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct OllamaChunk {
    #[serde(default)]
    model: String,
    message: Option<OllamaChunkMessage>,
    done: bool,
    #[serde(default)]
    eval_count: i32,
    #[serde(default)]
    prompt_eval_count: i32,
}

#[derive(Debug, Deserialize)]
struct OllamaChunkMessage {
    #[serde(default)]
    content: String,
}

#[derive(Debug, Deserialize)]
struct DirectiveResult {
    directives: Vec<DirectiveItem>,
}

#[derive(Debug, Deserialize)]
struct DirectiveItem {
    name: String,
    args: std::collections::BTreeMap<String, serde_json::Value>,
}

pub struct StreamResult {
    pub full_text: String,
    pub directives: Vec<Directive>,
    pub prompt_tokens: i32,
    pub output_tokens: i32,
}

pub async fn parse_stream(
    mut body: reqwest::Response,
    mut token_callback: Option<&mut dyn FnMut(String)>,
) -> Result<StreamResult, String> {
    let mut full = String::new();
    let mut in_think = false;

    while let Some(chunk_result) = {
        let chunk = body
            .chunk()
            .await
            .map_err(|e| format!("http chunk: {}", e))?;
        chunk
    } {
        let text = String::from_utf8_lossy(&chunk_result).to_string();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<OllamaChunk>(line) {
                if let Some(msg) = chunk.message {
                    let tok = &msg.content;

                    if tok.contains("<thinking>") {
                        in_think = true;
                    }
                    if tok.contains("</thinking>") {
                        in_think = false;
                        continue;
                    }

                    if !in_think && !tok.contains("<thinking>") {
                        if let Some(ref mut cb) = token_callback {
                            cb(tok.clone());
                        }
                    }
                    full.push_str(tok);
                }
                if chunk.done {
                    let directives = extract_directives(&full);
                    return Ok(StreamResult {
                        full_text: full,
                        directives,
                        prompt_tokens: chunk.prompt_eval_count,
                        output_tokens: chunk.eval_count,
                    });
                }
            }
        }
    }

    Ok(StreamResult {
        full_text: full,
        directives: vec![],
        prompt_tokens: 0,
        output_tokens: 0,
    })
}

pub fn parse_stream_sync(body: &[u8]) -> Result<StreamResult, String> {
    let text = String::from_utf8_lossy(body);
    let mut full = String::new();
    let mut in_think = false;
    let mut prompt_tokens = 0;
    let mut output_tokens = 0;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(chunk) = serde_json::from_str::<OllamaChunk>(line) {
            if let Some(msg) = chunk.message {
                let tok = &msg.content;
                if tok.contains("<thinking>") {
                    in_think = true;
                }
                if tok.contains("</thinking>") {
                    in_think = false;
                    continue;
                }
                if !in_think && !tok.contains("<thinking>") {
                    full.push_str(tok);
                }
            }
            if chunk.done {
                prompt_tokens = chunk.prompt_eval_count;
                output_tokens = chunk.eval_count;
                let directives = extract_directives(&full);
                return Ok(StreamResult {
                    full_text: full,
                    directives,
                    prompt_tokens,
                    output_tokens,
                });
            }
        }
    }

    Ok(StreamResult {
        full_text: full,
        directives: vec![],
        prompt_tokens,
        output_tokens,
    })
}

pub fn extract_directives(content: &str) -> Vec<Directive> {
    let mut directives = Vec::new();

    if let Ok(result) = serde_json::from_str::<DirectiveResult>(content) {
        for d in result.directives {
            let mut args = serde_json::Map::new();
            for (k, v) in d.args {
                args.insert(k, v);
            }
            if VALID_DIRECTIVES.contains(&d.name.as_str()) {
                directives.push(Directive { name: d.name, args });
            }
        }
        if !directives.is_empty() {
            return directives;
        }
    }

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('<') && trimmed.ends_with("/>") {
            if let Some((name, args)) = parse_tag_line(trimmed) {
                directives.push(Directive { name, args });
            }
        }
    }

    directives
}

fn parse_tag_line(line: &str) -> Option<(String, serde_json::Map<String, serde_json::Value>)> {
    let inner = line
        .trim()
        .trim_start_matches('<')
        .trim_end_matches("/>")
        .trim_end_matches('>')
        .trim();
    let mut parts = inner.splitn(2, char::is_whitespace);
    let name = parts.next()?.to_string();
    let mut args = serde_json::Map::new();
    if let Some(rest) = parts.next() {
        for pair in rest.split_whitespace() {
            if let Some((k, v)) = pair.split_once('=') {
                args.insert(
                    k.to_string(),
                    serde_json::Value::String(v.trim_matches('"').to_string()),
                );
            }
        }
    }
    Some((name, args))
}

const VALID_DIRECTIVES: &[&str] = &[
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
];
