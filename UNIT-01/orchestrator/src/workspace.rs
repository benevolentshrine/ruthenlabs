use crate::clients::indexer::IndexerClient;
use std::path::Path;

pub struct Workspace {
    pub path: String,
    pub session_id: String,
    pub project_map: String,
    pub instructions: String,
    pub identity: String,
    pub active: bool,
}

impl Workspace {
    pub fn new() -> Self {
        Self {
            path: String::new(),
            session_id: String::new(),
            project_map: String::new(),
            instructions: String::new(),
            identity: String::new(),
            active: false,
        }
    }

    pub async fn set(&mut self, path: &str) -> String {
        self.path = path.to_string();
        self.session_id = "local".to_string();
        self.active = true;

        let indexer = IndexerClient::new();
        if let Ok(m) = indexer.get_project_map(path).await {
            self.project_map = m;
        }

        let instr_path = Path::new(path).join("UNIT-01.md");
        if let Ok(data) = std::fs::read_to_string(&instr_path) {
            self.instructions = data;
        }

        self.identity = String::new();
        let go_mod_path = Path::new(path).join("go.mod");
        if let Ok(data) = std::fs::read_to_string(&go_mod_path) {
            self.identity.push_str("--- GO.MOD ---\n");
            self.identity.push_str(&data);
            self.identity.push('\n');
        }

        self.session_id.clone()
    }

    pub async fn refresh(&mut self) {
        if !self.active {
            return;
        }
        let indexer = IndexerClient::new();
        match indexer.get_project_map(&self.path).await {
            Ok(m) => self.project_map = m,
            Err(e) => self.project_map = format!("[Indexer Error: {}]", e),
        }
    }
}
