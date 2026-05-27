use crate::llm_client::LLMClient;

pub struct ModelProfile {
    pub name: String,
    pub family: String,
    pub parameter_size: String,
    pub parameters_b: f64,
    pub context_window: u64,
    pub allow_thinking: bool,
    pub max_retries: u32,
    pub compaction_pct: f64,
    pub max_tool_output_chars: usize,
    pub max_messages_per_turn: usize,
    pub temperature: f64,
}

impl ModelProfile {
    pub async fn load(llm: &mut LLMClient) -> Self {
        let mut p = Self {
            name: llm.model.clone(),
            family: String::new(),
            parameter_size: String::new(),
            parameters_b: 3.0,
            context_window: 8192,
            allow_thinking: false,
            max_retries: 2,
            compaction_pct: 0.75,
            max_tool_output_chars: 2000,
            max_messages_per_turn: 4,
            temperature: 0.0,
        };

        if let Ok(show) = llm.show_model().await {
            if let Some(ref details) = show.details {
                p.family = details.family.clone().unwrap_or_default();
                p.parameter_size = details.parameter_size.clone().unwrap_or_default();
                p.parameters_b = parse_param_size(&p.parameter_size);
            }

            if let Some(ref info) = show.model_info {
                if let Some(cnt) = info.get("general.parameter_count") {
                    if let Some(f) = cnt.as_f64() {
                        if f > 0.0 { p.parameters_b = f / 1e9; }
                    }
                }

                p.context_window = extract_context_len(info, &p.family);
                if p.context_window == 0 { p.context_window = 8192; }
            }

            let pb = p.parameters_b;
            if pb < 1.0 {
                p.allow_thinking = false;
                p.max_retries = 1;
                p.compaction_pct = 0.60;
                p.max_tool_output_chars = 500;
                p.max_messages_per_turn = 3;
                p.temperature = 0.0;
            } else if pb < 5.0 {
                p.allow_thinking = false;
                p.max_retries = 2;
                p.compaction_pct = 0.70;
                p.max_tool_output_chars = 2000;
                p.max_messages_per_turn = 4;
                p.temperature = 0.0;
            } else if pb < 15.0 {
                p.allow_thinking = true;
                p.max_retries = 3;
                p.compaction_pct = 0.80;
                p.max_tool_output_chars = 4000;
                p.max_messages_per_turn = 6;
                p.temperature = 0.1;
            } else if pb < 50.0 {
                p.allow_thinking = true;
                p.max_retries = 3;
                p.compaction_pct = 0.85;
                p.max_tool_output_chars = 8000;
                p.max_messages_per_turn = 8;
                p.temperature = 0.2;
            } else {
                p.allow_thinking = true;
                p.max_retries = 4;
                p.compaction_pct = 0.90;
                p.max_tool_output_chars = 16000;
                p.max_messages_per_turn = 10;
                p.temperature = 0.3;
            }
        }

        p
    }
}

fn parse_param_size(s: &str) -> f64 {
    let s = s.to_uppercase().trim().to_string();
    if let Some(n) = s.strip_suffix('B') {
        if let Ok(v) = n.parse::<f64>() { return v; }
    }
    if let Some(n) = s.strip_suffix('M') {
        if let Ok(v) = n.parse::<f64>() { return v / 1000.0; }
    }
    3.0
}

fn extract_context_len(info: &serde_json::Value, family: &str) -> u64 {
    if let Some(obj) = info.as_object() {
        let family_key = format!("{}.context_length", family);
        if let Some(v) = obj.get(&family_key) {
            if let Some(n) = v.as_u64() { return n; }
            if let Some(n) = v.as_f64() { return n as u64; }
        }
        if let Some(v) = obj.get("llama.context_length") {
            if let Some(n) = v.as_u64() { return n; }
            if let Some(n) = v.as_f64() { return n as u64; }
        }
        for (_k, v) in obj {
            if let Some(n) = v.as_u64() { return n; }
            if let Some(f) = v.as_f64() {
                if f > 0.0 { return f as u64; }
            }
        }
    }
    0
}
