use crate::models::FileRecord;
use chrono::Utc;
use content_inspector::{inspect, ContentType};
use ignore::{WalkBuilder, WalkState};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tracing::{error, info, warn};

pub struct Walker {
    root_path: PathBuf,
}

impl Walker {
    pub fn new<P: AsRef<Path>>(root_path: P) -> Self {
        Self {
            root_path: root_path.as_ref().to_path_buf(),
        }
    }

    pub fn walk(&self) -> Vec<FileRecord> {
        info!("Walking {:?}", self.root_path);

        let (tx, rx) = mpsc::channel();

        let walker = WalkBuilder::new(&self.root_path)
            .hidden(false)
            .ignore(false)
            .git_ignore(true)
            .add_custom_ignore_filename(".indexerignore")
            .filter_entry(|entry| {
                if let Some(name) = entry.file_name().to_str() {
                    name != "target"
                        && name != "node_modules"
                        && name != "dist"
                        && name != ".git"
                        && name != ".ruthen"
                        && name != "indexer_index"
                        && name != ".githooks"
                        && name != ".github"
                } else {
                    true
                }
            })
            .build_parallel();

        walker.run(|| {
            let tx = tx.clone();
            let root_path = self.root_path.clone();

            Box::new(move |result| {
                let entry = match result {
                    Ok(e) => e,
                    Err(err) => {
                        error!("Walk error: {}", err);
                        return WalkState::Continue;
                    }
                };
                let path = entry.path();
                if path.is_dir() {
                    return WalkState::Continue;
                }
                match process_file(path, &root_path) {
                    Ok(Some(record)) => {
                        let _ = tx.send(record);
                    }
                    Ok(None) => {}
                    Err(e) => warn!("Skip {:?}: {}", path, e),
                }
                WalkState::Continue
            })
        });

        drop(tx);
        let records: Vec<_> = rx.into_iter().collect();
        info!("Walked {} files", records.len());
        records
    }
}

fn process_file(
    path: &Path,
    root_path: &Path,
) -> Result<Option<FileRecord>, Box<dyn std::error::Error>> {
    let metadata = match path.symlink_metadata() {
        Ok(m) => m,
        Err(e) => {
            warn!("Skip {:?}: {}", path, e);
            return Ok(None);
        }
    };

    let is_symlink = metadata.file_type().is_symlink();
    let path_str = path.to_string_lossy().to_string();
    let relative_path = path
        .strip_prefix(root_path)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    let size_bytes = metadata.len();
    let mtime_unix = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let extension = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    let is_binary = if size_bytes > 0 {
        let mut buf = [0; 1024];
        if let Ok(mut f) = std::fs::File::open(path) {
            if let Ok(n) = f.read(&mut buf) {
                inspect(&buf[..n]) == ContentType::BINARY
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    let language = extension_to_language(&extension);

    #[cfg(unix)]
    let permissions = {
        use std::os::unix::fs::PermissionsExt;
        format!("{:o}", metadata.permissions().mode() & 0o777)
    };
    #[cfg(not(unix))]
    let permissions = String::from("644");

    Ok(Some(FileRecord {
        path: path_str,
        relative_path,
        size_bytes,
        mtime_unix,
        language,
        extension,
        is_binary,
        is_symlink,
        permissions,
        indexed_at: Utc::now().to_rfc3339(),
    }))
}

fn extension_to_language(ext: &str) -> String {
    match ext {
        ".rs" => "Rust",
        ".go" => "Go",
        ".py" => "Python",
        ".js" => "JavaScript",
        ".ts" => "TypeScript",
        ".tsx" => "TypeScript",
        ".jsx" => "JavaScript",
        ".java" => "Java",
        ".c" => "C",
        ".cpp" | ".cc" | ".cxx" => "C++",
        ".h" | ".hpp" => "C",
        ".rb" => "Ruby",
        ".php" => "PHP",
        ".swift" => "Swift",
        ".kt" | ".kts" => "Kotlin",
        ".scala" => "Scala",
        ".rlib" => "Rust",
        ".md" | ".markdown" => "Markdown",
        ".json" => "JSON",
        ".toml" => "TOML",
        ".yaml" | ".yml" => "YAML",
        ".html" | ".htm" => "HTML",
        ".css" => "CSS",
        ".scss" | ".sass" => "SCSS",
        ".sql" => "SQL",
        ".sh" | ".bash" | ".zsh" | ".fish" => "Shell",
        ".lua" => "Lua",
        ".pl" => "Perl",
        ".r" => "R",
        ".dart" => "Dart",
        ".zig" => "Zig",
        _ => "Unknown",
    }
    .to_string()
}

pub fn find_files(name: &str, root: &str) -> Vec<String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Vec::new();
    }
    let mut results = Vec::new();
    let walker = WalkBuilder::new(root_path)
        .filter_entry(|entry| {
            if let Some(n) = entry.file_name().to_str() {
                n != "target"
                    && n != "node_modules"
                    && n != "dist"
                    && n != ".git"
                    && n != ".ruthen"
                    && n != "indexer_index"
                    && n != ".githooks"
                    && n != ".github"
            } else {
                true
            }
        })
        .build();
    for entry in walker.flatten() {
        if entry.path().is_file() {
            if let Some(fname) = entry.path().file_name().and_then(|n| n.to_str()) {
                if fname.contains(name) || name.is_empty() {
                    results.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }
    results.sort();
    results
}

pub fn glob_files(pattern: &str, base: &str) -> Result<Vec<String>, String> {
    use globset::{Glob, GlobSetBuilder};
    let mut builder = GlobSetBuilder::new();
    builder.add(Glob::new(pattern).map_err(|e| e.to_string())?);
    let glob_set = builder.build().map_err(|e| e.to_string())?;

    let base_path = Path::new(base);
    if !base_path.is_dir() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let walker = WalkBuilder::new(base_path)
        .filter_entry(|entry| {
            if let Some(n) = entry.file_name().to_str() {
                n != "target"
                    && n != "node_modules"
                    && n != "dist"
                    && n != ".git"
                    && n != ".ruthen"
                    && n != "indexer_index"
                    && n != ".githooks"
                    && n != ".github"
            } else {
                true
            }
        })
        .build();
    for entry in walker.flatten() {
        if entry.path().is_file() {
            let rel = entry.path().strip_prefix(base_path).unwrap_or(entry.path());
            if glob_set.is_match(rel) {
                results.push(rel.to_string_lossy().to_string());
            }
        }
    }
    results.sort();
    Ok(results)
}
