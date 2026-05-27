pub enum ReviewAction {
    Approve,
    Reject,
    Suggest(String),
}

pub fn detect_language(path: &str) -> &str {
    let lower = path.to_lowercase();
    if lower.ends_with(".rs") { "Rust" }
    else if lower.ends_with(".go") { "Go" }
    else if lower.ends_with(".py") { "Python" }
    else if lower.ends_with(".js") { "JavaScript" }
    else if lower.ends_with(".ts") { "TypeScript" }
    else if lower.ends_with(".html") { "HTML" }
    else if lower.ends_with(".css") { "CSS" }
    else if lower.ends_with(".json") { "JSON" }
    else if lower.ends_with(".toml") { "TOML" }
    else if lower.ends_with(".yaml") || lower.ends_with(".yml") { "YAML" }
    else if lower.ends_with(".md") { "Markdown" }
    else if lower.ends_with(".sh") { "Shell" }
    else if lower.ends_with(".jsx") { "JSX" }
    else if lower.ends_with(".tsx") { "TSX" }
    else { "Text" }
}
