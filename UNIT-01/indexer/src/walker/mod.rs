use crate::models::FileRecord;
use ignore::{WalkBuilder, WalkState};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tracing::{error, info, warn};
use chrono::Utc;
use content_inspector::{inspect, ContentType};
use std::io::Read;

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
        info!("Starting directory walk at: {:?}", self.root_path);
        
        let (tx, rx) = mpsc::channel();
        
        // Use WalkBuilder from ignore crate
        let walker = WalkBuilder::new(&self.root_path)
            .hidden(false) 
            .ignore(false) 
            .git_ignore(true) // Read .gitignore
            .add_custom_ignore_filename(".indexerignore")
            .build_parallel();

        walker.run(|| {
            let tx = tx.clone();
            let root_path = self.root_path.clone();
            
            Box::new(move |result| {
                let entry = match result {
                    Ok(entry) => entry,
                    Err(err) => {
                        error!("Error during walk: {}", err);
                        return WalkState::Continue;
                    }
                };

                let path = entry.path();
                
                // Skip directories
                if path.is_dir() {
                    return WalkState::Continue;
                }

                // Process file
                match process_file(path, &root_path) {
                    Ok(Some(record)) => {
                        let _ = tx.send(record);
                    }
                    Ok(None) => {},
                    Err(e) => {
                        error!("Failed to process file {:?}: {}", path, e);
                    }
                }

                WalkState::Continue
            })
        });

        drop(tx);

        let mut records = Vec::new();
        for record in rx {
            records.push(record);
        }

        info!("Walk completed. Found {} files.", records.len());
        records
    }
}

pub fn process_file(path: &Path, root_path: &Path) -> Result<Option<FileRecord>, Box<dyn std::error::Error>> {
    let metadata = match path.symlink_metadata() {
        Ok(m) => m,
        Err(e) => {
            warn!("Skipping {:?}: {}", path, e);
            return Ok(None);
        }
    };
    
    let is_symlink = metadata.file_type().is_symlink();
    
    let path_str = path.to_string_lossy().to_string();
    let relative_path = path.strip_prefix(root_path)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
        
    let size_bytes = metadata.len();
    
    let mtime_unix = metadata.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
        
    let extension = path.extension()
        .map(|e| e.to_string_lossy().to_string())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();
        
    let mut is_binary = false;
    
    // Check if binary and hash
    let hash = if size_bytes > 0 {
        let mut buffer = [0; 1024];
        if let Ok(mut file) = std::fs::File::open(path) {
            if let Ok(n) = file.read(&mut buffer) {
                if inspect(&buffer[..n]) == ContentType::BINARY {
                    is_binary = true;
                }
            }
        }
        String::from("open_core_skipped")
    } else {
        String::from("open_core_skipped")
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
        hash,
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
        ".js" => "JavaScript",
        ".ts" => "TypeScript",
        ".py" => "Python",
        ".md" => "Markdown",
        ".json" => "JSON",
        ".toml" => "TOML",
        ".yml" | ".yaml" => "YAML",
        ".c" => "C",
        ".cpp" | ".cc" | ".cxx" => "C++",
        ".go" => "Go",
        ".java" => "Java",
        ".html" => "HTML",
        ".css" => "CSS",
        _ => "Unknown",
    }.to_string()
}

pub struct ProjectWalker {
    root_path: PathBuf,
}

impl ProjectWalker {
    pub fn new(root_path: PathBuf) -> Self {
        Self { root_path }
    }

    pub fn generate_map(&self) -> String {
        let mut map = String::new();
        let walker = WalkBuilder::new(&self.root_path)
            .hidden(false)
            .git_ignore(true)
            .max_depth(Some(4)) // Don't go too deep for the map
            .build();

        for entry in walker.flatten() {
            let path = entry.path();
            if let Ok(rel_path) = path.strip_prefix(&self.root_path) {
                let depth = rel_path.components().count();
                if depth == 0 { continue; }
                
                let indent = "  ".repeat(depth - 1);
                let name = rel_path.file_name().unwrap_or_default().to_string_lossy();
                let prefix = if path.is_dir() { "📁" } else { "📄" };
                
                map.push_str(&format!("{} {} {}\n", indent, prefix, name));
                
                if map.len() > 10000 {
                    map.push_str("... (truncated)\n");
                    break;
                }
            }
        }
        map
    }
}
