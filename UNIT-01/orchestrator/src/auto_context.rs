use crate::clients::indexer::IndexerClient;
use crate::workspace::Workspace;
use std::path::Path;

pub async fn get_auto_context(input: &str, ws: &Workspace) -> String {
    if !ws.active {
        return String::new();
    }

    let indexer = IndexerClient::new();
    match indexer.search(input).await {
        Ok(records) if !records.is_empty() => {
            let mut context =
                String::from("\n# IMPLICIT CONTEXT (Pre-fetched based on your request):\n");
            let mut found = 0;
            for rec in &records {
                let full_path = if Path::new(&rec.path).is_absolute() {
                    rec.path.clone()
                } else {
                    format!("{}/{}", ws.path, rec.path)
                };
                if let Ok(data) = std::fs::read_to_string(&full_path) {
                    found += 1;
                    let content = if data.len() > 2000 {
                        format!("{}\n... (truncated)", &data[..2000])
                    } else {
                        data
                    };
                    context.push_str(&format!("\n## File: {}\n```\n{}\n```\n", rec.path, content));
                }
                if found >= 3 {
                    break;
                }
            }
            if found > 0 {
                return context;
            }
        }
        Ok(_) => {}
        Err(_) => {}
    }

    search_chat_history(input, ws)
}

fn search_chat_history(input: &str, ws: &Workspace) -> String {
    if !ws.active {
        return String::new();
    }

    let chat_path = Path::new(&ws.path).join(".ruthen").join("chat_history.md");
    let content = match std::fs::read_to_string(&chat_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let input_lower = input.to_lowercase();
    let input_words: Vec<&str> = input_lower
        .split_whitespace()
        .filter(|w| w.len() >= 4)
        .collect();

    if input_words.is_empty() {
        return String::new();
    }

    let mut relevant: Vec<String> = Vec::new();
    for block in content.split("---") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let block_lower = block.to_lowercase();
        let matches = input_words
            .iter()
            .filter(|w| block_lower.contains(*w))
            .count();
        if matches >= 3 {
            let truncated = if block.len() > 1000 {
                format!("{}\n... (truncated)", &block[..1000])
            } else {
                block.to_string()
            };
            relevant.push(truncated);
            if relevant.len() >= 3 {
                break;
            }
        }
    }

    if relevant.is_empty() {
        return String::new();
    }

    let mut result = String::from("\n# IMPLICIT CONTEXT (Past conversation history):\n");
    for block in &relevant {
        result.push_str(&format!("\n### Past Discussion:\n{}\n", block));
    }
    result
}
