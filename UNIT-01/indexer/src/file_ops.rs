use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tracing::{error, info};

use crate::index::storage::Storage;
use crate::models::FileRecord;

/// Manages high-performance indexing into Sled.
pub struct IndexManager {
    storage: Storage,
    write_lock: Arc<Mutex<()>>,
}

impl IndexManager {
    pub fn new(storage: Storage, write_lock: Arc<Mutex<()>>) -> Self {
        Self {
            storage,
            write_lock,
        }
    }

    /// Batch write records to the index.
    /// Replaces the legacy atomic_write_index with Sled batch updates.
    pub fn write_index(&self, records: Vec<FileRecord>) -> Result<(), Box<dyn std::error::Error>> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|e| format!("Write mutex poisoned: {}", e))?;

        info!("Indexing {} files into Sled...", records.len());

        self.storage
            .batch_insert(records)
            .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

        Ok(())
    }
}

/// Legacy support for path resolution
pub fn get_index_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("INDEXER_DATA_DIR") {
        let dir = PathBuf::from(env_dir);
        if !dir.exists() {
            let _ = std::fs::create_dir_all(&dir);
        }
        return dir;
    }
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "ruthenlabs", "indexer") {
        let data_dir = proj_dirs.data_dir().to_path_buf();
        if !data_dir.exists() {
            std::fs::create_dir_all(&data_dir).unwrap_or_else(|e| {
                error!("Failed to create data directory: {}", e);
            });
        }
        data_dir
    } else {
        PathBuf::from("indexer_index")
    }
}
