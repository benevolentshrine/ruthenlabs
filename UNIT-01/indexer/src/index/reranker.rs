use std::path::Path;
use std::sync::Mutex;

use ort::session::Session;
use ort::value::Tensor;
use tokenizers::tokenizer::Tokenizer;

use crate::models::SearchResult;

pub struct CrossEncoder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
}

impl CrossEncoder {
    pub fn new(model_path: &Path, tokenizer_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("session builder: {}", e))?
            .with_intra_threads(2)
            .map_err(|e| format!("{}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("commit model: {}", e))?;

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("load tokenizer: {}", e))?;

        if let Err(e) = tokenizer.encode("test", false) {
            return Err(format!("tokenizer test encode failed: {}", e));
        }

        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
        })
    }

    pub fn rerank(
        &self,
        query: &str,
        candidates: &[SearchResult],
        top_k: usize,
    ) -> Vec<SearchResult> {
        if candidates.is_empty() || top_k == 0 {
            return candidates.to_vec();
        }

        let mut scored: Vec<(SearchResult, f32)> = Vec::with_capacity(candidates.len());

        for candidate in candidates {
            let text = format!("{} {} {}", query, candidate.filepath, candidate.text);
            let score = self.score_pair(query, &text);
            scored.push((candidate.clone(), score));
        }

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        scored
            .into_iter()
            .take(top_k)
            .map(|(mut r, s)| {
                r.score = s as f64;
                r
            })
            .collect()
    }

    fn score_pair(&self, query: &str, candidate: &str) -> f32 {
        let text = format!("[CLS] {} [SEP] {} [SEP]", query, candidate);

        let encoding = match self.tokenizer.encode(text, false) {
            Ok(e) => e,
            Err(_) => return 0.0,
        };

        let input_ids: Vec<i64> = encoding
            .get_ids()
            .iter()
            .take(512)
            .map(|&id| id as i64)
            .collect();

        let attention_mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .take(512)
            .map(|&m| m as i64)
            .collect();

        let token_type_ids: Vec<i64> = encoding
            .get_type_ids()
            .iter()
            .take(512)
            .map(|&t| t as i64)
            .collect();

        let seq_len = input_ids.len();
        if seq_len == 0 {
            return 0.0;
        }

        let input_ids_tensor =
            Tensor::from_array((vec![1i64, seq_len as i64], input_ids))
                .expect("input_ids tensor");
        let attention_mask_tensor =
            Tensor::from_array((vec![1i64, seq_len as i64], attention_mask))
                .expect("attention_mask tensor");
        let token_type_ids_tensor =
            Tensor::from_array((vec![1i64, seq_len as i64], token_type_ids))
                .expect("token_type_ids tensor");

        let mut session = match self.session.lock() {
            Ok(s) => s,
            Err(_) => return 0.0,
        };

        let outputs = match session.run(ort::inputs![
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
            "token_type_ids" => token_type_ids_tensor,
        ]) {
            Ok(o) => o,
            Err(_) => return 0.0,
        };

        let logits = match outputs.get("logits") {
            Some(v) => v,
            None => return 0.0,
        };

        let (shape, data) = match logits.try_extract_tensor::<f32>() {
            Ok(t) => t,
            Err(_) => return 0.0,
        };

        let dims = shape.as_ref();
        if dims.is_empty() || data.is_empty() {
            return 0.0;
        }

        if dims.len() == 2 && dims[1] >= 2 {
            data[1]
        } else {
            data[0]
        }
    }
}
