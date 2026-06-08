use std::path::Path;

use rusqlite::{params, Connection};

use crate::index::chunker::Chunk;
use crate::index::embed::Embedder;

pub struct VectorStore {
    conn: Connection,
}

impl VectorStore {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chunks (
                id          TEXT PRIMARY KEY,
                filepath    TEXT NOT NULL,
                relpath     TEXT NOT NULL,
                language    TEXT NOT NULL,
                start_line  INTEGER NOT NULL,
                end_line    INTEGER NOT NULL,
                content     TEXT NOT NULL,
                chunk_type  TEXT NOT NULL,
                name        TEXT,
                embedding   BLOB,
                indexed_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_filepath ON chunks(filepath);
            CREATE INDEX IF NOT EXISTS idx_chunks_language ON chunks(language);
            CREATE INDEX IF NOT EXISTS idx_chunks_name ON chunks(name);",
        )?;
        Ok(Self {
            conn,
        })
    }

    pub fn insert_chunks(
        &self,
        chunks: &[Chunk],
        embedder: &dyn Embedder,
    ) -> rusqlite::Result<usize> {
        let mut count = 0;
        let tx = self.conn.unchecked_transaction()?;

        for chunk in chunks {
            let embedding = embedder.embed(&chunk.content);
            let mut embedding_bytes = Vec::with_capacity(embedding.len() * 4);
            for &val in &embedding {
                embedding_bytes.extend_from_slice(&val.to_ne_bytes());
            }

            tx.execute(
                "INSERT OR REPLACE INTO chunks
                (id, filepath, relpath, language, start_line, end_line, content, chunk_type, name, embedding, indexed_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))",
                params![
                    chunk.chunk_id,
                    chunk.filepath,
                    chunk.relative_path,
                    chunk.language,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    chunk.content,
                    format!("{:?}", chunk.chunk_type),
                    chunk.name,
                    embedding_bytes,
                ],
            )?;
            count += 1;
        }

        tx.commit()?;
        Ok(count)
    }

    pub fn remove_file(&self, filepath: &str) -> rusqlite::Result<usize> {
        let count = self
            .conn
            .execute("DELETE FROM chunks WHERE filepath = ?1", params![filepath])?;
        Ok(count)
    }

    pub fn vector_search(
        &self,
        query_embedding: &[f32],
        limit: usize,
    ) -> rusqlite::Result<Vec<(Chunk, f32)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, filepath, relpath, language, start_line, end_line, content, chunk_type, name, embedding
             FROM chunks WHERE embedding IS NOT NULL",
        )?;

        let mut results: Vec<(Chunk, f32)> = Vec::new();

        let rows = stmt.query_map([], |row| {
            let embedding_blob: Vec<u8> = row.get(9)?;
            let embedding: Vec<f32> = if embedding_blob.len() == query_embedding.len() * 4 {
                embedding_blob
                    .chunks_exact(4)
                    .map(|chunk| f32::from_ne_bytes(chunk.try_into().unwrap()))
                    .collect()
            } else {
                bincode::deserialize(&embedding_blob).unwrap_or_default()
            };

            Ok((
                Chunk {
                    chunk_id: row.get(0)?,
                    filepath: row.get(1)?,
                    relative_path: row.get(2)?,
                    language: row.get(3)?,
                    start_line: row.get::<_, i64>(4)? as usize,
                    end_line: row.get::<_, i64>(5)? as usize,
                    content: row.get(6)?,
                    chunk_type: crate::index::chunker::ChunkType::Block,
                    name: row.get(8)?,
                },
                embedding,
            ))
        })?;

        for row in rows {
            let (chunk, embedding) = row?;
            let score = crate::index::embed::cosine_similarity(query_embedding, &embedding);
            if score > 0.0 {
                results.push((chunk, score));
            }
        }

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(limit);
        Ok(results)
    }

    pub fn chunk_count(&self) -> rusqlite::Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))?;
        Ok(count as usize)
    }

}
