use crate::models::FileRecord;
use bincode;
use sled::{Db, Tree};
use std::io;
use std::path::Path;

#[derive(Clone)]
pub struct Storage {
    db: Db,
    metadata: Tree,
    doc_index: Tree,
}

impl Storage {
    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        let db = sled::open(path)?;
        let metadata = db.open_tree("metadata")?;
        let doc_index = db.open_tree("doc_index")?;

        Ok(Self {
            db,
            metadata,
            doc_index,
        })
    }

    pub fn list_records(&self) -> io::Result<Vec<FileRecord>> {
        let mut records = Vec::new();
        for result in self.metadata.iter() {
            let (_, value) = result.map_err(io::Error::other)?;
            let record = bincode::deserialize::<FileRecord>(&value).map_err(io::Error::other)?;
            records.push(record);
        }
        Ok(records)
    }

    pub fn get_record(&self, path: &str) -> io::Result<Option<FileRecord>> {
        let res = self
            .metadata
            .get(path.as_bytes())
            .map_err(io::Error::other)?;

        match res {
            Some(bytes) => {
                let record =
                    bincode::deserialize::<FileRecord>(&bytes).map_err(io::Error::other)?;
                Ok(Some(record))
            }
            None => Ok(None),
        }
    }

    pub fn batch_insert(&self, records: Vec<FileRecord>) -> io::Result<()> {
        for record in records {
            let path_bytes = record.path.as_bytes();
            let encoded_record = bincode::serialize(&record).map_err(io::Error::other)?;

            self.metadata
                .insert(path_bytes, encoded_record.as_slice())
                .map_err(io::Error::other)?;

            let mut lang_key = record.language.as_bytes().to_vec();
            lang_key.extend_from_slice(b"|");
            lang_key.extend_from_slice(path_bytes);
            self.doc_index
                .insert(&lang_key, &[] as &[u8])
                .map_err(io::Error::other)?;
        }

        self.db.flush().map_err(io::Error::other)?;

        Ok(())
    }
}
