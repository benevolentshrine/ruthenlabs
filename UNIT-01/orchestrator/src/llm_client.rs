use crate::schema::directive_schema;
use crate::stream_parser::parse_stream;
use crate::types::{Directive, OllamaMessage, OllamaRequest};
use serde::Deserialize;
use std::time::Duration;

const OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434";

pub struct LLMClient {
    pub endpoint: String,
    pub model: String,
    client: reqwest::Client,
    show_cache: Option<ModelShowResponse>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelShowResponse {
    pub modelfile: Option<String>,
    pub parameters: Option<String>,
    pub template: Option<String>,
    pub details: Option<ModelDetails>,
    pub model_info: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelDetails {
    pub parent_model: Option<String>,
    pub format: Option<String>,
    pub family: Option<String>,
    pub families: Option<Vec<String>>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

impl LLMClient {
    pub fn new(model: &str) -> Self {
        Self {
            endpoint: OLLAMA_ENDPOINT.to_string(),
            model: model.to_string(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .expect("reqwest client"),
            show_cache: None,
        }
    }

    pub async fn show_model(&mut self) -> Result<ModelShowResponse, String> {
        if let Some(ref cached) = self.show_cache {
            return Ok(cached.clone());
        }
        let body = serde_json::json!({"name": self.model});
        let resp = self
            .client
            .post(format!("{}/api/show", self.endpoint))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("http: {}", e))?;

        let show: ModelShowResponse = resp.json().await.map_err(|e| format!("json: {}", e))?;
        self.show_cache = Some(show.clone());
        Ok(show)
    }

    pub async fn stream_directives(
        &self,
        messages: Vec<OllamaMessage>,
        temperature: f64,
    ) -> Result<(Vec<Directive>, i32, i32), String> {
        let req = OllamaRequest {
            model: self.model.clone(),
            messages,
            stream: true,
            format: Some(directive_schema()),
            options: Some(
                serde_json::json!({"temperature": temperature})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        };

        let resp = self
            .client
            .post(format!("{}/api/chat", self.endpoint))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("http: {}", e))?;

        let result = parse_stream(resp, None).await?;
        Ok((
            result.directives,
            result.prompt_tokens,
            result.output_tokens,
        ))
    }

    pub async fn stream_cli(
        &self,
        messages: Vec<OllamaMessage>,
        token_cb: &mut dyn FnMut(String),
        temperature: f64,
    ) -> Result<(String, Vec<Directive>, i32, i32), String> {
        let req = OllamaRequest {
            model: self.model.clone(),
            messages,
            stream: true,
            format: None,
            options: Some(
                serde_json::json!({"temperature": temperature})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        };

        let resp = self
            .client
            .post(format!("{}/api/chat", self.endpoint))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("http: {}", e))?;

        let mut result = parse_stream(resp, Some(token_cb)).await?;
        if result.directives.is_empty() {
            result.directives = crate::stream_parser::extract_directives(&result.full_text);
        }
        Ok((
            result.full_text,
            result.directives,
            result.prompt_tokens,
            result.output_tokens,
        ))
    }

    pub async fn chat(&self, messages: Vec<OllamaMessage>) -> Result<String, String> {
        let req = OllamaRequest {
            model: self.model.clone(),
            messages,
            stream: false,
            format: None,
            options: None,
        };

        let resp = self
            .client
            .post(format!("{}/api/chat", self.endpoint))
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("http: {}", e))?;

        #[derive(Deserialize)]
        struct ChatResp {
            message: ChatRespMessage,
        }
        #[derive(Deserialize)]
        struct ChatRespMessage {
            content: String,
        }

        let cr: ChatResp = resp.json().await.map_err(|e| format!("json: {}", e))?;
        Ok(cr.message.content)
    }
}
