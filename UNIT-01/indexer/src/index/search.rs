use std::io;
use std::path::Path;
use std::sync::Arc;

use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::tokenizer::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};
use tracing::info;

use crate::index::chunker::Chunk;
use crate::index::embed::Embedder;
use crate::index::hybrid;
use crate::index::reranker::CrossEncoder;
use crate::index::vector::VectorStore;
use crate::models::SearchResult;

const NUM_THREADS: usize = 4;

pub struct SearchIndex {
    index: Index,
    schema: Schema,
    reader: IndexReader,
    pub vector_store: Option<VectorStore>,
    pub embedder: Option<Arc<dyn Embedder + Send + Sync>>,
    pub reranker: Option<CrossEncoder>,
}

impl SearchIndex {
    pub fn open(index_dir: &Path) -> io::Result<Self> {
        let mut schema_builder = Schema::builder();
        let _path_field = schema_builder.add_text_field("path", STRING | STORED);
        let _content_field = schema_builder.add_text_field("content", TEXT | STORED);
        let _language_field = schema_builder.add_text_field("language", STRING | STORED);
        let _line_field = schema_builder.add_u64_field("line", STORED);
        let _chunk_id_field = schema_builder.add_text_field("chunk_id", STRING | STORED);
        let _name_field = schema_builder.add_text_field("name", STRING | STORED);
        let _chunk_type_field = schema_builder.add_text_field("chunk_type", STRING | STORED);
        let schema = schema_builder.build();

        let index_path = index_dir.join("tantivy");
        let index = if index_path.exists() {
            Index::open_in_dir(&index_path).map_err(|e| {
                io::Error::new(io::ErrorKind::Other, format!("open tantivy index: {}", e))
            })?
        } else {
            std::fs::create_dir_all(&index_path).ok();
            let idx = Index::create_in_dir(&index_path, schema.clone()).map_err(|e| {
                io::Error::new(io::ErrorKind::Other, format!("create tantivy index: {}", e))
            })?;
            let tokenizer = TextAnalyzer::builder(SimpleTokenizer::default())
                .filter(LowerCaser)
                .build();
            idx.tokenizers().register("default", tokenizer);
            idx
        };

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("tantivy reader: {}", e)))?;

        let vector_db_path = index_dir.join("vectors.db");
        let vector_store = VectorStore::open(&vector_db_path).ok();

        Ok(Self {
            index,
            schema,
            reader,
            vector_store,
            embedder: None,
            reranker: None,
        })
    }

    pub fn set_embedder(&mut self, embedder: Arc<dyn Embedder + Send + Sync>) {
        self.embedder = Some(embedder);
    }

    pub fn set_reranker(&mut self, reranker: CrossEncoder) {
        self.reranker = Some(reranker);
    }

    pub fn index_chunks(&mut self, chunks: &[Chunk]) -> io::Result<()> {
        let path_field = self.schema.get_field("path").unwrap();
        let content_field = self.schema.get_field("content").unwrap();
        let language_field = self.schema.get_field("language").unwrap();
        let line_field = self.schema.get_field("line").unwrap();
        let chunk_id_field = self.schema.get_field("chunk_id").unwrap();
        let name_field = self.schema.get_field("name").unwrap();
        let chunk_type_field = self.schema.get_field("chunk_type").unwrap();

        let mut writer: IndexWriter = self
            .index
            .writer_with_num_threads(NUM_THREADS, 64_000_000)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("writer: {}", e)))?;

        for chunk in chunks {
            if chunk.content.trim().is_empty() {
                continue;
            }

            for (line_num, line_text) in chunk.content.lines().enumerate() {
                let line_text = line_text.trim();
                if line_text.is_empty() {
                    continue;
                }

                writer
                    .add_document(doc!(
                        path_field => chunk.relative_path.as_str(),
                        content_field => line_text,
                        language_field => chunk.language.as_str(),
                        line_field => (chunk.start_line + line_num) as u64 + 1,
                        chunk_id_field => chunk.chunk_id.as_str(),
                        name_field => chunk.name.as_deref().unwrap_or(""),
                        chunk_type_field => format!("{:?}", chunk.chunk_type),
                    ))
                    .map_err(|e| {
                        io::Error::new(io::ErrorKind::Other, format!("add doc: {}", e))
                    })?;
            }
        }

        writer
            .commit()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("commit: {}", e)))?;

        self.reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("reload reader: {}", e)))?;

        info!("Indexed {} chunks into Tantivy", chunks.len());
        Ok(())
    }

    pub fn search(
        &self,
        query_str: &str,
        lang_filter: Option<&str>,
        path_filter: Option<&str>,
        limit: usize,
    ) -> io::Result<Vec<SearchResult>> {
        let top_k = limit.max(20);
        let rerank_k = top_k * 3;
        let fuse_k = if self.reranker.is_some() { rerank_k } else { top_k };

        let bm25_results = self.bm25_search(query_str, lang_filter, path_filter, fuse_k)?;

        let mut fused = if let (Some(embedder), Some(vector_store)) = (&self.embedder, &self.vector_store) {
            let query_embedding = embedder.embed(query_str);
            let vector_results = vector_store
                .vector_search(&query_embedding, fuse_k)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("vector search: {}", e)))?;

            let ranked = hybrid::fuse_results(bm25_results, vector_results, fuse_k);
            hybrid::ranked_to_results(&ranked)
        } else {
            bm25_results
        };

        if let Some(reranker) = &self.reranker {
            fused = reranker.rerank(query_str, &fused, top_k);
        }

        Ok(fused)
    }

    pub fn semantic_search(&self, query: &str, limit: usize) -> io::Result<Vec<SearchResult>> {
        let embedder = self
            .embedder
            .as_ref()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "No embedder configured"))?;
        let vector_store = self
            .vector_store
            .as_ref()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "No vector store configured"))?;

        let top_k = limit.max(10);
        let rerank_k = top_k * 3;
        let fuse_k = if self.reranker.is_some() { rerank_k } else { top_k };

        let query_embedding = embedder.embed(query);

        let bm25_results = self.bm25_search(query, None, None, fuse_k)?;

        let vector_results = vector_store
            .vector_search(&query_embedding, fuse_k)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("vector search: {}", e)))?;

        let ranked = hybrid::fuse_results(bm25_results, vector_results, fuse_k);
        let mut fused = hybrid::ranked_to_results(&ranked);

        if let Some(reranker) = &self.reranker {
            fused = reranker.rerank(query, &fused, top_k);
        }

        Ok(fused)
    }

    pub fn bm25_search(
        &self,
        query_str: &str,
        lang_filter: Option<&str>,
        path_filter: Option<&str>,
        limit: usize,
    ) -> io::Result<Vec<SearchResult>> {
        let searcher = self.reader.searcher();
        let content_field = self.schema.get_field("content").unwrap();
        let path_field = self.schema.get_field("path").unwrap();
        let language_field = self.schema.get_field("language").unwrap();
        let line_field = self.schema.get_field("line").unwrap();

        let mut query_parts = Vec::new();
        query_parts.push(format!("{}", query_str));

        if let Some(lang) = lang_filter {
            query_parts.push(format!("language:{}", lang));
        }
        if let Some(p) = path_filter {
            query_parts.push(format!("path:{}", p));
        }

        let combined = query_parts.join(" AND ");

        let query_parser = QueryParser::for_index(&self.index, vec![content_field, path_field]);

        let query = match query_parser.parse_query(&combined) {
            Ok(q) => q,
            Err(e) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("query parse: {}", e),
                ));
            }
        };

        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(limit))
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("search: {}", e)))?;

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let doc = searcher
                .doc::<TantivyDocument>(doc_address)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("fetch doc: {}", e)))?;

            let filepath = doc
                .get_first(path_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let text = doc
                .get_first(content_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let line = doc
                .get_first(line_field)
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            let language = doc
                .get_first(language_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            results.push(SearchResult {
                filepath,
                line,
                text,
                score: score.into(),
                language,
            });
        }

        Ok(results)
    }
}
