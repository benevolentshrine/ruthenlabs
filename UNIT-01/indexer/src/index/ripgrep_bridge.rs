use std::io;
use std::path::Path;
use std::process::Command;

pub struct RipgrepBridge;

impl RipgrepBridge {
    /// Searches for a pattern across a directory using the `rg` binary.
    /// Returns a list of matching absolute paths.
    pub fn search(
        root: &Path,
        pattern: &str,
        glob_pattern: Option<&str>,
        language_filter: Option<&str>,
    ) -> io::Result<Vec<String>> {
        let mut cmd = Command::new("rg");

        // 1. Pattern
        if pattern.is_empty() {
            cmd.arg("--files");
        } else {
            cmd.arg(pattern);
        }

        // 2. Glob filtering
        if let Some(glob) = glob_pattern {
            cmd.arg("-g").arg(glob);
        }

        // 3. Language filtering
        if let Some(lang) = language_filter {
            // ripgrep uses -t for built-in types.
            // We assume the user provides a valid ripgrep type name (e.g., 'rust', 'cpp').
            cmd.arg("-t").arg(lang);
        }

        // 4. Output options
        cmd.arg("-l") // Only print filenames
            .arg("--no-ignore") // Ignore .gitignore for a more complete index search
            .arg(root);

        let output = cmd.output().map_err(|e| {
            if e.kind() == io::ErrorKind::NotFound {
                io::Error::new(io::ErrorKind::NotFound, "ripgrep ('rg') binary not found in PATH. Please install it (e.g., 'brew install ripgrep') for search to work.")
            } else {
                e
            }
        })?;

        if !output.status.success() {
            // rg returns 1 if no matches are found, which is not a fatal error.
            if output.status.code() == Some(1) {
                return Ok(Vec::new());
            }
            return Err(io::Error::other(format!(
                "ripgrep failed with status {}",
                output.status
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().map(|s| s.to_string()).collect())
    }
}
