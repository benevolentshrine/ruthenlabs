use crate::types::{Message, OllamaMessage};
use chrono::Utc;

const MAX_HISTORY: usize = 1000;

pub struct History {
    pub messages: Vec<Message>,
}

impl History {
    pub fn new() -> Self {
        Self { messages: Vec::with_capacity(MAX_HISTORY) }
    }

    pub fn append(&mut self, m: Message) {
        if self.messages.len() >= MAX_HISTORY {
            match self.messages.len() {
                0 => {}
                1 => { self.messages.remove(0); }
                _ => { self.messages.drain(0..2); }
            }
        }
        self.messages.push(m);
    }

    pub fn compact(&mut self, summary: &str, count: usize) {
        if count > self.messages.len() { return; }
        let summary_msg = Message {
            role: "system".to_string(),
            content: format!("📦 CONTEXT COMPACTED: {}", summary),
            thinking: String::new(),
            timestamp: Utc::now(),
        };
        let remaining = self.messages.split_off(count);
        self.messages.clear();
        self.messages.push(summary_msg);
        self.messages.extend(remaining);
    }

    pub fn token_estimate(&self) -> usize {
        self.messages.iter().map(|m| m.content.len() / 4).sum()
    }

    pub fn all(&self) -> &[Message] {
        &self.messages
    }

    pub fn len(&self) -> usize {
        self.messages.len()
    }

    pub fn last(&self) -> Option<&Message> {
        self.messages.last()
    }

    pub fn build_ollama_messages(&self, max_messages: usize) -> Vec<OllamaMessage> {
        let all = self.ollama_messages();
        if all.len() <= max_messages {
            all
        } else {
            all[all.len() - max_messages..].to_vec()
        }
    }

    pub fn ollama_messages(&self) -> Vec<OllamaMessage> {
        self.messages.iter()
            .filter(|m| m.content != "Thinking…")
            .map(|m| OllamaMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect()
    }
}
