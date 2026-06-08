use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub chunk_id: String,
    pub filepath: String,
    pub relative_path: String,
    pub language: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
    pub chunk_type: ChunkType,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChunkType {
    Function,
    Class,
    Module,
    Block,
}

pub fn chunk_file(
    content: &str,
    filepath: &str,
    relative_path: &str,
    language: &str,
) -> Vec<Chunk> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return vec![];
    }

    let ext = Path::new(filepath)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let boundaries = detect_boundaries(&lines, language, ext);

    if boundaries.is_empty() {
        return file_chunk(&lines, filepath, relative_path, language);
    }

    let mut chunks = Vec::new();
    for (_i, window) in boundaries.windows(2).enumerate() {
        let (start_line, chunk_type, name) = &window[0];
        let end_line = window[1].0;
        let chunk_content = lines[*start_line..end_line]
            .join("\n")
            .trim()
            .to_string();
        if chunk_content.is_empty() {
            continue;
        }
        chunks.push(Chunk {
            chunk_id: format!("{}:{}:{}", relative_path, start_line, end_line - 1),
            filepath: filepath.to_string(),
            relative_path: relative_path.to_string(),
            language: language.to_string(),
            start_line: *start_line,
            end_line: end_line - 1,
            content: chunk_content,
            chunk_type: chunk_type.clone(),
            name: name.clone(),
        });
    }

    chunks
}

fn file_chunk(lines: &[&str], filepath: &str, relative_path: &str, language: &str) -> Vec<Chunk> {
    vec![Chunk {
        chunk_id: relative_path.to_string(),
        filepath: filepath.to_string(),
        relative_path: relative_path.to_string(),
        language: language.to_string(),
        start_line: 0,
        end_line: lines.len().saturating_sub(1),
        content: lines.join("\n").trim().to_string(),
        chunk_type: ChunkType::Module,
        name: Some(
            Path::new(filepath)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
    }]
}

type Boundary = (usize, ChunkType, Option<String>);

fn detect_boundaries(lines: &[&str], language: &str, _ext: &str) -> Vec<Boundary> {
    let mut boundaries: Vec<Boundary> = vec![(0, ChunkType::Module, None)];

    let patterns = match language {
        "Rust" => rust_patterns(),
        "Python" => python_patterns(),
        "JavaScript" | "TypeScript" => ts_patterns(),
        "Go" => go_patterns(),
        "Java" => java_patterns(),
        "C++" | "C" => c_patterns(),
        "Ruby" => ruby_patterns(),
        "Kotlin" => kotlin_patterns(),
        "Swift" => swift_patterns(),
        "PHP" => php_patterns(),
        "Shell" => shell_patterns(),
        "Lua" => lua_patterns(),
        "Zig" => zig_patterns(),
        _ => return vec![],
    };

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        for pat in &patterns {
            if pat.re.is_match(trimmed) {
                boundaries.push((i, pat.chunk_type.clone(), None));
                break;
            }
        }
    }

    boundaries.sort_by_key(|b| b.0);
    boundaries.dedup_by_key(|b| b.0);

    boundaries
}

struct Pat {
    re: Regex,
    chunk_type: ChunkType,
}

fn pat(p: &str, t: ChunkType) -> Pat {
    Pat {
        re: Regex::new(p).unwrap(),
        chunk_type: t,
    }
}

fn rust_patterns() -> Vec<Pat> {
    vec![
        pat(r"^fn\s+", ChunkType::Function),
        pat(r"^pub\s+fn\s+", ChunkType::Function),
        pat(r"^pub\s+(unsafe\s+)?fn\s+", ChunkType::Function),
        pat(r"^struct\s+\w+", ChunkType::Class),
        pat(r"^enum\s+\w+", ChunkType::Class),
        pat(r"^impl\s+", ChunkType::Class),
        pat(r"^trait\s+\w+", ChunkType::Class),
        pat(r"^mod\s+\w+", ChunkType::Block),
        pat(r"^macro_rules!\s+\w+", ChunkType::Function),
        pat(r"^#\[test\]\s*$", ChunkType::Function),
        pat(r"^pub\s+(async\s+)?fn\s+", ChunkType::Function),
    ]
}

fn python_patterns() -> Vec<Pat> {
    vec![
        pat(r"^def\s+", ChunkType::Function),
        pat(r"^async\s+def\s+", ChunkType::Function),
        pat(r"^class\s+\w+", ChunkType::Class),
        pat(r"^@\w+\.?(?:setter|deleter|getter)?\s*$", ChunkType::Function),
    ]
}

fn ts_patterns() -> Vec<Pat> {
    vec![
        pat(r"^function\s+", ChunkType::Function),
        pat(r"^export\s+(default\s+)?function\s+", ChunkType::Function),
        pat(r"^(export\s+)?(async\s+)?function\s+", ChunkType::Function),
        pat(r"^(export\s+)?class\s+\w+", ChunkType::Class),
        pat(r"^(export\s+)?interface\s+\w+", ChunkType::Class),
        pat(r"^(export\s+)?type\s+\w+\s*=", ChunkType::Class),
        pat(r"^(export\s+)?enum\s+\w+", ChunkType::Class),
        pat(r"^(export\s+)?abstract\s+class\s+\w+", ChunkType::Class),
        pat(r"^(export\s+)?(default\s+)?(async\s+)?arrow\s+function", ChunkType::Function),
        pat(r"^\w+\s*\([^)]*\)\s*\{[^}]*\}$", ChunkType::Function),
        pat(r"^\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>", ChunkType::Function),
        pat(r"^\w+\s*=\s*(async\s+)?function", ChunkType::Function),
    ]
}

fn go_patterns() -> Vec<Pat> {
    vec![
        pat(r"^func\s+", ChunkType::Function),
        pat(r"^type\s+\w+\s+struct", ChunkType::Class),
        pat(r"^type\s+\w+\s+interface", ChunkType::Class),
    ]
}

fn java_patterns() -> Vec<Pat> {
    vec![
        pat(r"^(public|private|protected)\s+\w+\s+\w+\s*\(", ChunkType::Function),
        pat(r"^(public|private|protected)\s+class\s+\w+", ChunkType::Class),
        pat(r"^(public|private|protected)\s+interface\s+\w+", ChunkType::Class),
        pat(r"^(public|private|protected)\s+enum\s+\w+", ChunkType::Class),
        pat(r"^(public|private|protected)\s+@\w+", ChunkType::Function),
        pat(r"^@\w+", ChunkType::Function),
    ]
}

fn c_patterns() -> Vec<Pat> {
    vec![
        pat(r"^\w+\s+\w+\s*\(", ChunkType::Function),
        pat(r"^\w+\s+\*\s*\w+\s*\(", ChunkType::Function),
        pat(r"^class\s+\w+", ChunkType::Class),
        pat(r"^struct\s+\w+", ChunkType::Class),
    ]
}

fn ruby_patterns() -> Vec<Pat> {
    vec![
        pat(r"^def\s+", ChunkType::Function),
        pat(r"^class\s+\w+", ChunkType::Class),
        pat(r"^module\s+\w+", ChunkType::Block),
    ]
}

fn kotlin_patterns() -> Vec<Pat> {
    vec![
        pat(r"^fun\s+", ChunkType::Function),
        pat(r"^class\s+\w+", ChunkType::Class),
        pat(r"^interface\s+\w+", ChunkType::Class),
        pat(r"^object\s+\w+", ChunkType::Class),
    ]
}

fn swift_patterns() -> Vec<Pat> {
    vec![
        pat(r"^func\s+", ChunkType::Function),
        pat(r"^class\s+\w+", ChunkType::Class),
        pat(r"^struct\s+\w+", ChunkType::Class),
        pat(r"^enum\s+\w+", ChunkType::Class),
        pat(r"^protocol\s+\w+", ChunkType::Class),
    ]
}

fn php_patterns() -> Vec<Pat> {
    vec![
        pat(r"^function\s+", ChunkType::Function),
        pat(r"^(public|private|protected)\s+function\s+", ChunkType::Function),
        pat(r"^class\s+\w+", ChunkType::Class),
        pat(r"^interface\s+\w+", ChunkType::Class),
        pat(r"^trait\s+\w+", ChunkType::Class),
    ]
}

fn shell_patterns() -> Vec<Pat> {
    vec![
        pat(r"^\w+\s*\(\)\s*\{", ChunkType::Function),
        pat(r"^function\s+\w+\s*\{", ChunkType::Function),
    ]
}

fn lua_patterns() -> Vec<Pat> {
    vec![
        pat(r"^function\s+", ChunkType::Function),
        pat(r"^(local\s+)?function\s+", ChunkType::Function),
    ]
}

fn zig_patterns() -> Vec<Pat> {
    vec![
        pat(r"^fn\s+", ChunkType::Function),
        pat(r"^pub\s+fn\s+", ChunkType::Function),
        pat(r"^const\s+\w+\s*=\s*struct", ChunkType::Class),
    ]
}

pub fn language_from_ext(ext: &str) -> &str {
    match ext {
        "rs" => "Rust",
        "go" => "Go",
        "py" => "Python",
        "js" => "JavaScript",
        "ts" => "TypeScript",
        "tsx" => "TypeScript",
        "jsx" => "JavaScript",
        "java" => "Java",
        "c" => "C",
        "cpp" | "cc" | "cxx" => "C++",
        "h" | "hpp" => "C",
        "rb" => "Ruby",
        "php" => "PHP",
        "swift" => "Swift",
        "kt" | "kts" => "Kotlin",
        "scala" => "Scala",
        "rlib" => "Rust",
        "md" | "markdown" => "Markdown",
        "json" => "JSON",
        "toml" => "TOML",
        "yaml" | "yml" => "YAML",
        "html" | "htm" => "HTML",
        "css" => "CSS",
        "scss" | "sass" => "SCSS",
        "sql" => "SQL",
        "sh" | "bash" | "zsh" | "fish" => "Shell",
        "lua" => "Lua",
        "pl" => "Perl",
        "r" => "R",
        "dart" => "Dart",
        "zig" => "Zig",
        _ => "Unknown",
    }
}
