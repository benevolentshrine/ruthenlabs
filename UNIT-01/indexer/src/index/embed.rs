use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const EMBEDDING_DIM: usize = 256;

pub trait Embedder: Send + Sync {
    fn embed(&self, text: &str) -> Vec<f32>;
    fn dimension(&self) -> usize;
}

pub struct HashEmbedder;

impl HashEmbedder {
    pub fn new() -> Self {
        Self
    }
}

impl Embedder for HashEmbedder {
    fn embed(&self, text: &str) -> Vec<f32> {
        let mut vec = vec![0.0f32; EMBEDDING_DIM];
        let terms: Vec<&str> = text
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| !t.is_empty() && t.len() > 1)
            .collect();

        for term in &terms {
            let mut hasher = DefaultHasher::new();
            term.hash(&mut hasher);
            let hash = hasher.finish();
            let idx = (hash as usize) % EMBEDDING_DIM;
            vec[idx] += 1.0;
        }

        for term in terms.windows(2) {
            let mut hasher = DefaultHasher::new();
            term[0].hash(&mut hasher);
            term[1].hash(&mut hasher);
            let hash = hasher.finish();
            let idx = (hash as usize) % EMBEDDING_DIM;
            vec[idx] += 0.5;
        }

        let magnitude: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        if magnitude > 0.0 {
            for x in &mut vec {
                *x /= magnitude;
            }
        }

        vec
    }

    fn dimension(&self) -> usize {
        EMBEDDING_DIM
    }
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    // Since embedders always return normalized unit vectors (magnitude = 1.0),
    // cosine similarity is exactly equivalent to the dot product.
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}
