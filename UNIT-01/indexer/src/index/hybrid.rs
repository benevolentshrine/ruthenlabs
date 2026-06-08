use std::collections::HashMap;

use crate::index::chunker::Chunk;
use crate::models::SearchResult;

const RRF_K: f64 = 60.0;

pub struct RankedItem {
    pub chunk: Chunk,
    pub bm25_score: f64,
    pub vector_score: f64,
    pub rrf_score: f64,
}

pub fn fuse_results(
    bm25_results: Vec<SearchResult>,
    vector_results: Vec<(Chunk, f32)>,
    top_k: usize,
) -> Vec<RankedItem> {
    let mut rank_map: HashMap<String, RankedItem> = HashMap::new();

    for (rank, result) in bm25_results.iter().enumerate() {
        let chunk_id = format!("{}:{}", result.filepath, result.line);
        let chunk = Chunk {
            chunk_id: chunk_id.clone(),
            filepath: result.filepath.clone(),
            relative_path: result.filepath.clone(),
            language: result.language.clone(),
            start_line: result.line,
            end_line: result.line,
            content: result.text.clone(),
            chunk_type: crate::index::chunker::ChunkType::Block,
            name: None,
        };
        let rrf_contrib = 1.0 / (RRF_K + rank as f64 + 1.0);
        rank_map.insert(
            chunk_id,
            RankedItem {
                chunk,
                bm25_score: rrf_contrib,
                vector_score: 0.0,
                rrf_score: rrf_contrib,
            },
        );
    }

    for (rank, (chunk, _score)) in vector_results.iter().enumerate() {
        let chunk_id = chunk.chunk_id.clone();
        let rrf_contrib = 1.0 / (RRF_K + rank as f64 + 1.0);
        if let Some(item) = rank_map.get_mut(&chunk_id) {
            item.vector_score = rrf_contrib;
            item.rrf_score = item.bm25_score + rrf_contrib;
        } else {
            rank_map.insert(
                chunk_id,
                RankedItem {
                    chunk: chunk.clone(),
                    bm25_score: 0.0,
                    vector_score: rrf_contrib,
                    rrf_score: rrf_contrib,
                },
            );
        }
    }

    let mut ranked: Vec<RankedItem> = rank_map.into_values().collect();
    ranked.sort_by(|a, b| b.rrf_score.partial_cmp(&a.rrf_score).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(top_k);
    ranked
}

pub fn ranked_to_results(ranked: &[RankedItem]) -> Vec<SearchResult> {
    ranked
        .iter()
        .map(|r| SearchResult {
            filepath: r.chunk.relative_path.clone(),
            line: r.chunk.start_line,
            text: r.chunk.content.clone(),
            score: r.rrf_score,
            language: r.chunk.language.clone(),
        })
        .collect()
}
