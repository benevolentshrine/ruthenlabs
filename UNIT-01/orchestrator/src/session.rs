use crate::history::History;
use crate::types::Message;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub name: String,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionData {
    #[serde(flatten)]
    pub meta: SessionMeta,
    pub history: Vec<Message>,
}

fn sessions_dir() -> String {
    if let Some(home) = home::home_dir() {
        let dir = format!("{}/.ruthen/unit01/sessions", home.display());
        let _ = std::fs::create_dir_all(&dir);
        dir
    } else {
        "/tmp/ruthen-sessions".to_string()
    }
}

pub fn save_session(id: &str, name: &str, history: &History) -> Result<(), String> {
    if id.is_empty() {
        return Ok(());
    }
    let dir = sessions_dir();
    let path = format!("{}/{}.json", dir, id);

    let data = SessionData {
        meta: SessionMeta {
            id: id.to_string(),
            name: name.to_string(),
            last_updated: Utc::now().to_rfc3339(),
        },
        history: history.messages.clone(),
    };

    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&path, &json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_session(id: &str, history: &mut History) -> Result<String, String> {
    let dir = sessions_dir();
    let path = format!("{}/{}.json", dir, id);

    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let session: SessionData = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    history.messages = session.history;
    Ok(session.meta.name)
}

pub fn list_sessions() -> Vec<SessionMeta> {
    let dir = sessions_dir();
    let mut sessions = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(data) = std::fs::read_to_string(&path) {
                    if let Ok(meta) = serde_json::from_str::<SessionMeta>(&data) {
                        sessions.push(meta);
                    }
                }
            }
        }
    }

    sessions.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));
    sessions
}
