use std::io;

use crate::index::ripgrep_bridge::RipgrepBridge;
use crate::index::storage::Storage;
use crate::models::FileRecord;

pub struct QueryEngine {
    storage: Storage,
}

impl QueryEngine {
    pub fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub fn execute(
        &self,
        pattern: &str,
        lang_filter: Option<&str>,
        path_filter: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> io::Result<Vec<FileRecord>> {
        // 1. Delegate heavy lifting to ripgrep
        // We use the current working directory as root for the bridge
        let root = std::env::current_dir()?;
        let matching_paths = RipgrepBridge::search(&root, pattern, path_filter, lang_filter)?;

        // 2. Hydrate metadata from Sled
        // We only fetch the records for the paths returned by ripgrep
        let mut records = Vec::new();
        for path in matching_paths {
            if let Some(record) = self.storage.get_record(&path)? {
                // Double-check language filter if ripgrep's -t was not specific enough
                if let Some(lang) = lang_filter {
                    if record.language != lang {
                        continue;
                    }
                }
                records.push(record);
            }
        }

        // 3. Pagination
        // Since the results are already filtered by ripgrep, we just apply offset and limit
        let start = offset.min(records.len());
        let end = (offset + limit).min(records.len());

        Ok(records[start..end].to_vec())
    }
}
