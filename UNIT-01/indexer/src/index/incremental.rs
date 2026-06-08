use std::io;
use std::path::Path;

use sled::Db;
use xxhash_rust::xxh3::xxh3_128;

pub struct ContentHashStore {
    db: Db,
}

impl ContentHashStore {
    pub fn open(path: &Path) -> io::Result<Self> {
        let db = sled::open(path)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("sled content hash: {}", e)))?;
        Ok(Self { db })
    }

    fn content_hash(content: &[u8]) -> String {
        let hash = xxh3_128(content);
        format!("{:032x}", hash)
    }

    pub fn has_changed(&self, filepath: &str, content: &[u8]) -> io::Result<bool> {
        let current_hash = Self::content_hash(content);
        match self.db.get(filepath.as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("sled get: {}", e)))? 
        {
            Some(stored) => {
                let stored_str = std::str::from_utf8(&stored)
                    .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("utf8: {}", e)))?;
                Ok(stored_str != current_hash)
            }
            None => Ok(true),
        }
    }

    pub fn update_hash(&self, filepath: &str, content: &[u8]) -> io::Result<()> {
        let hash = Self::content_hash(content);
        self.db
            .insert(filepath.as_bytes(), hash.as_bytes())
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("sled insert: {}", e)))?;
        Ok(())
    }

    pub fn flush(&self) -> io::Result<()> {
        self.db
            .flush()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("sled flush: {}", e)))?;
        Ok(())
    }
}
