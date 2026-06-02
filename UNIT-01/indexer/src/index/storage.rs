use std::io;
use std::path::PathBuf;

use sled::Db;
use tracing::error;

use crate::models::FileRecord;

pub fn index_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("INDEXER_DATA_DIR") {
        let dir = PathBuf::from(env_dir);
        std::fs::create_dir_all(&dir).ok();
        return dir;
    }
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "ruthenlabs", "indexer") {
        let dir = proj_dirs.data_dir().to_path_buf();
        std::fs::create_dir_all(&dir).ok();
        dir
    } else {
        PathBuf::from("indexer_index")
    }
}

fn metadata_db(index_dir: &PathBuf) -> io::Result<Db> {
    let path = index_dir.join("metadata.sled");
    sled::open(&path).map_err(|e| io::Error::new(io::ErrorKind::Other, format!("sled: {}", e)))
}

pub fn save_metadata(index_dir: &PathBuf, records: &[FileRecord]) -> io::Result<()> {
    let db = metadata_db(index_dir)?;
    let tree = db
        .open_tree("metadata")
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("open tree: {}", e)))?;

    for record in records {
        let key = record.path.as_bytes();
        let value = bincode::serialize(record)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("bincode: {}", e)))?;
        tree.insert(key, value).map_err(|e| {
            io::Error::new(io::ErrorKind::Other, format!("sled insert: {}", e))
        })?;
    }

    db.flush().map_err(|e| io::Error::new(io::ErrorKind::Other, format!("flush: {}", e)))?;
    Ok(())
}

pub fn load_metadata(index_dir: &PathBuf) -> io::Result<Vec<FileRecord>> {
    let db = match metadata_db(index_dir) {
        Ok(d) => d,
        Err(e) => {
            error!("Failed to open metadata db: {}", e);
            return Ok(Vec::new());
        }
    };
    let tree = match db.open_tree("metadata") {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to open metadata tree: {}", e);
            return Ok(Vec::new());
        }
    };

    let mut records = Vec::new();
    for result in tree.iter() {
        let (_, value) = result.map_err(|e| {
            io::Error::new(io::ErrorKind::Other, format!("sled iter: {}", e))
        })?;
        match bincode::deserialize::<FileRecord>(&value) {
            Ok(record) => records.push(record),
            Err(e) => error!("Failed to deserialize record: {}", e),
        }
    }
    Ok(records)
}
