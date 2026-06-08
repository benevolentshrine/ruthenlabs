use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ort::session::Session;
use ort::value::Tensor;
use tokenizers::tokenizer::Tokenizer;

use crate::index::embed::Embedder;

const MAX_LENGTH: usize = 512;

pub struct OrtEmbedder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    dimension: usize,
}

impl OrtEmbedder {
    pub fn new(model_path: &Path, tokenizer_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("session builder: {}", e))?
            .with_intra_threads(2)
            .map_err(|e| e.to_string())?
            .commit_from_file(model_path)
            .map_err(|e| format!("commit model: {}", e))?;

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("load tokenizer: {}", e))?;

        if let Err(e) = tokenizer.encode("test", false) {
            return Err(format!("tokenizer test encode failed: {}", e));
        }

        let dim = Self::infer_dimension(&session)?;

        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
            dimension: dim,
        })
    }

    fn infer_dimension(_session: &Session) -> Result<usize, String> {
        Ok(384)
    }

    pub fn model_dir() -> PathBuf {
        if let Ok(dir) = std::env::var("INDEXER_MODEL_DIR") {
            return PathBuf::from(dir);
        }
        let base = std::env::temp_dir().join("ruthen").join("indexer_models");
        std::fs::create_dir_all(&base).ok();
        base
    }

    pub fn is_model_available() -> bool {
        let dir = Self::model_dir();
        dir.join("model.onnx").exists() && dir.join("tokenizer.json").exists()
    }
}

impl Embedder for OrtEmbedder {
    fn embed(&self, text: &str) -> Vec<f32> {
        let encoding = match self.tokenizer.encode(text, false) {
            Ok(e) => e,
            Err(_) => return vec![0.0; self.dimension],
        };

        let input_ids: Vec<i64> = encoding
            .get_ids()
            .iter()
            .take(MAX_LENGTH)
            .map(|&id| id as i64)
            .collect();

        let attention_mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .take(MAX_LENGTH)
            .map(|&m| m as i64)
            .collect();

        let token_type_ids: Vec<i64> = encoding
            .get_type_ids()
            .iter()
            .take(MAX_LENGTH)
            .map(|&t| t as i64)
            .collect();

        let seq_len = input_ids.len();
        let attn_mask = attention_mask.clone();

        let input_ids_tensor = Tensor::from_array(
            (vec![1i64, seq_len as i64], input_ids),
        )
        .expect("create input_ids tensor");

        let attention_mask_tensor = Tensor::from_array(
            (vec![1i64, seq_len as i64], attention_mask),
        )
        .expect("create attention_mask tensor");

        let token_type_ids_tensor = Tensor::from_array(
            (vec![1i64, seq_len as i64], token_type_ids),
        )
        .expect("create token_type_ids tensor");

        let mut session = match self.session.lock() {
            Ok(s) => s,
            Err(_) => return vec![0.0; self.dimension],
        };

        let outputs = match session.run(ort::inputs![
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
            "token_type_ids" => token_type_ids_tensor,
        ]) {
            Ok(o) => o,
            Err(_) => return vec![0.0; self.dimension],
        };

        let last_hidden_state = match outputs.get("last_hidden_state")
            .or_else(|| outputs.get("sentence_embedding"))
        {
            Some(v) => v,
            None => return vec![0.0; self.dimension],
        };

        let (shape, data) = match last_hidden_state.try_extract_tensor::<f32>() {
            Ok(t) => t,
            Err(_) => return vec![0.0; self.dimension],
        };

        let dims = shape.as_ref();
        if dims.len() < 3 {
            return vec![0.0; self.dimension];
        }

        let num_tokens = dims[1] as usize;
        let hidden_dim = dims[2] as usize;

        let embedding = {
            let mut pooled = vec![0.0f32; hidden_dim];
            let mut token_count = 0usize;

            for token_idx in 0..num_tokens {
                if token_idx < attn_mask.len() && attn_mask[token_idx] == 0 {
                    continue;
                }
                token_count += 1;
                let offset = token_idx * hidden_dim;
                if offset + hidden_dim <= data.len() {
                    for dim in 0..hidden_dim {
                        pooled[dim] += data[offset + dim];
                    }
                }
            }

            if token_count > 0 {
                for dim in 0..hidden_dim {
                    pooled[dim] /= token_count as f32;
                }
            }
            pooled
        };

        let magnitude: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if magnitude > 0.0 {
            embedding.iter().map(|x| x / magnitude).collect()
        } else {
            embedding
        }
    }

    fn dimension(&self) -> usize {
        self.dimension
    }
}
