use crate::auto_context::get_auto_context;
use crate::daemon::DaemonManager;
use crate::executor::execute_tool;
use crate::history::History;
use crate::llm_client::LLMClient;
use crate::mcp::MCPManager;
use crate::model_profile::ModelProfile;
use crate::socket;
use crate::types::{Message, OllamaMessage};
use crate::workspace::Workspace;
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::Mutex;

pub struct AppState {
    pub messages: Vec<ChatMsg>,
    pub input: String,
    pub thinking: bool,
    pub current_response: String,
    pub status_label: String,
    pub cmd_model_name: String,
    pub model_name: String,
    pub model_size: String,
    pub indexer_online: bool,
    pub sandbox_online: bool,
    pub ws: Workspace,
    pub profile: ModelProfile,
    pub llm: LLMClient,
    pub daemon_mgr: Arc<DaemonManager>,
    pub mcp_mgr: Arc<MCPManager>,
    pub history: History,
    pub history_messages: Vec<Message>,
    pub tool_count: usize,
}

#[derive(Debug, Clone)]
pub struct ChatMsg {
    pub source: String,
    pub content: String,
}

async fn build_executor_prompt(ws: &Workspace, profile: &ModelProfile, auto_ctx: &str, mcp: &MCPManager) -> String {
    let home = home::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/tmp".to_string());

    let mcp_desc = mcp.tool_descriptions().await;

    let base = format!(
        "### UNIT-01 DIRECTIVE PROTOCOL (NON-NEGOTIABLE) ###\n\
         - OPERATING_SYSTEM: {}\n\
         - USER_HOME: {}\n\
         - CURRENT_WORKSPACE: {}\n\
         - ACTIVE_MODEL: {} ({})\n\
         - IDENTITY: You are the UNIT-01 SOVEREIGN ENGINE. You are a native coding orchestrator by Ruthen Labs.\n\n\
         ### GROUND TRUTH (PROJECT_MAP & CONTEXT):\n\
         {}\n\n\
         ### CORE DIRECTIVE:\n\
         1. INTERNAL KNOWLEDGE IS DEPRECATED. Use the Ground Truth context provided.\n\
         2. You DO have access to the file system.\n\
         3. Be concise. Talk is cheap. Show me the code.\n\n\
         ### DIRECTIVE TAGS (USE THESE FOR ALL ACTIONS):\n\
         - To write a file: <write path=\"path/to/file\">CONTENT</write>\n\
         - To execute a command: <execute command=\"CMD\" />\n\
         - To list a directory: <indexer_ls path=\"PATH\" />\n\
         - To read a file: <indexer_read path=\"PATH\" />\n\
         - To search file contents: <search query=\"pattern\" />\n\
         - To delete a file: <delete path=\"PATH\" />\n\
         - To patch a file: <patch path=\"PATH\" target=\"OLD\" replacement=\"NEW\" />\n\
         - To rollback changes: <rollback />\n\n\
         4. If writing code, use the <write> tag.{}",
        std::env::consts::OS, home, ws.path, profile.name, profile.parameter_size, ws.project_map, mcp_desc
    );

    if profile.allow_thinking {
        format!("{}\n\n### THINKING RULES:\n- You MAY use <thinking> tags to plan complex multi-file refactors.\n- Keep thinking concise and focused on code logic.", base)
    } else {
        format!("{}\n\n### THINKING RULES:\n- YOU MUST NOT use <thinking> tags.\n- YOU MUST ACT AS A PURE MECHANICAL TRANSLATOR.\n- NO CONVERSATION. NO EXPLANATIONS. OUTPUT ONLY CODE.", base)
    }
}

pub async fn run_ui(
    state: Arc<Mutex<AppState>>,
    mut rx: UnboundedReceiver<socket::SiblingMessage>,
) {
    // Spawn UDS listener handler
    let state_for_uds = state.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let mut app = state_for_uds.lock().await;
            let content = msg.payload.get("content")
                .or_else(|| msg.payload.get("text"))
                .or_else(|| msg.payload.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if content.is_empty() { continue; }

            if let Some(last) = app.messages.last_mut() {
                if last.source == msg.source {
                    last.content.push_str(&content);
                    continue;
                }
            }
            app.messages.push(ChatMsg {
                source: msg.source,
                content,
            });
        }
    });

    // Main chat loop (CLI-style for now, can be expanded with iocraft TUI)
    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    use tokio::io::AsyncBufReadExt;

    eprintln!("◆ Type your message and press Enter (Ctrl+C to exit)");
    eprintln!();

    let mut lines = stdin.lines();

    loop {
        // Print current messages if any new ones came in from UDS
        {
            let app = state.lock().await;
            if let Some(last) = app.messages.last() {
                if last.source != "user" {
                    // Already handled via prompt
                }
            }
        }

        let app = state.lock().await;
        let prompt = if app.thinking { "⏳ thinking... ".to_string() } else { "» ".to_string() };
        drop(app);
        eprint!("{}", prompt);

        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) | Err(_) => break,
        };

        let input = line.trim().to_string();
        if input.is_empty() { continue; }

        if input == "/exit" || input == "/quit" { break; }
        if input == "/clear" {
            let mut app = state.lock().await;
            app.messages.clear();
            app.history.messages.clear();
            continue;
        }

        // Process user input
        let mut app = state.lock().await;

        let user_msg = Message {
            role: "user".to_string(),
            content: input.clone(),
            thinking: String::new(),
            timestamp: Utc::now(),
        };
        app.messages.push(ChatMsg {
            source: "user".to_string(),
            content: input.clone(),
        });
        app.history.append(user_msg);
        app.thinking = true;
        app.current_response = String::new();
        app.status_label = String::new();

        // ─── PHASE 1: Directives ────────────────────────────────────
        let prompt = build_executor_prompt(
            &app.ws, &app.profile, &get_auto_context(&input, &app.ws).await, &app.mcp_mgr
        ).await;

        let directive_prompt = format!(
            "{}\n\n### DIRECTIVE PHASE (JSON STRUCTURED OUTPUT):\n\
             Map user requests to directives. NEVER use shell commands (ls, cat, grep, find, mv, cp, mkdir).\n\
             - To LIST a directory → indexer_ls with {{\"path\":\"...\"}}\n\
             - To READ a file → indexer_read with {{\"path\":\"...\"}}\n\
             - To READ multiple files at once → read_multiple with {{\"paths\":[\"...\",\"...\"]}}\n\
             - To SEARCH file contents → search with {{\"query\":\"...\"}}\n\
             - To GLOB for files by pattern → glob with {{\"pattern\":\"**/*.go\",\"base\":\"...\"}}\n\
             - To FIND files by name → find with {{\"name\":\"...\",\"root\":\"...\"}}\n\
             - To EXECUTE a command → execute with {{\"command\":\"...\"}}\n\
             - To WRITE a file → write with {{\"path\":\"...\",\"content\":\"...\"}}\n\
             - To APPEND to a file → append with {{\"path\":\"...\",\"content\":\"...\"}}\n\
             - To DELETE a file → delete with {{\"path\":\"...\"}}\n\
             - To PATCH a file → patch with {{\"path\":\"...\",\"target\":\"...\",\"replacement\":\"...\"}}\n\
             - To MOVE/RENAME a file → mv with {{\"from\":\"...\",\"to\":\"...\"}}\n\
             - To COPY a file → cp with {{\"from\":\"...\",\"to\":\"...\"}}\n\
             - To CREATE a directory → mkdir with {{\"path\":\"...\"}}\n\
             - To REMOVE a directory → rmdir with {{\"path\":\"...\"}}\n\
             - To GET file info → file_info with {{\"path\":\"...\"}}\n\
             - To DIFF two files → diff with {{\"files\":[\"...\",\"...\"]}}\n\
             - To VIEW project tree → ls_tree with {{\"root\":\"...\"}}\n\
             - To ROLLBACK changes → rollback with {{}}\n\
             Output ONLY a JSON object with a \"directives\" array. Do NOT include any explanation.",
            prompt
        );

        let mut ollama_msgs = vec![OllamaMessage {
            role: "system".to_string(),
            content: directive_prompt,
        }];
        ollama_msgs.extend(app.history.build_ollama_messages(app.profile.max_messages_per_turn));

        let mcp_mgr = app.mcp_mgr.clone();
        let ws_path = app.ws.path.clone();
        let ws_active = app.ws.active;
        let profile_ctx = app.profile.context_window as usize;
        let profile_retries = app.profile.max_retries;
        let profile_msgs = app.profile.max_messages_per_turn;
        let profile_temp = app.profile.temperature;
        let profile_max_tool = app.profile.max_tool_output_chars;
        let profile_compact = app.profile.compaction_pct;
        let model_name = app.cmd_model_name.clone();

        app.status_label = "◆ Planning...".to_string();
        drop(app);

        let (directives, _prompt_tokens, _output_tokens) = match LLMClient::new(&model_name)
            .stream_directives(ollama_msgs, profile_temp).await
        {
            Ok(result) => result,
            Err(e) => {
                let mut app = state.lock().await;
                app.thinking = false;
                app.status_label = String::new();
                app.messages.push(ChatMsg {
                    source: "system".to_string(),
                    content: format!("❌ Error: {}", e),
                });
                continue;
            }
        };

        // Process directives
        let mut app = state.lock().await;
        if directives.is_empty() {
            app.status_label = "".to_string();
        } else {
            app.status_label = format!("◆ Executing {} directive(s)...", directives.len());
        }
        drop(app);

        let mut tool_results: Vec<String> = Vec::new();
        for dir in &directives {
            let result = execute_tool(&dir.name, &dir.args, &crate::workspace::Workspace {
                path: ws_path.clone(),
                session_id: String::new(),
                project_map: String::new(),
                instructions: String::new(),
                identity: String::new(),
                active: ws_active,
            }, &mcp_mgr).await;

            let display = if result.len() > profile_max_tool {
                format!("[Tool '{}' output truncated: {} bytes]", dir.name, result.len())
            } else {
                result.clone()
            };

            tool_results.push(format!("  {} → {}", dir.name, display.lines().next().unwrap_or("")));

            let mut app = state.lock().await;
            app.history.append(Message {
                role: "system".to_string(),
                content: format!("Tool [{}] completed: {}", dir.name, result),
                thinking: String::new(),
                timestamp: Utc::now(),
            });
            drop(app);
        }

        // ─── PHASE 2: Response ──────────────────────────────────────
        let mut app = state.lock().await;
        app.status_label = "".to_string();
        drop(app);

        let phase2_prompt = format!(
            "{}\n\n### RESPONSE PHASE:\n\
             The directives have been executed. Results are in the conversation history above. \
             Now provide your natural language response to the user. Keep it concise.",
            prompt
        );

        let mut phase2_msgs = vec![OllamaMessage {
            role: "system".to_string(),
            content: phase2_prompt,
        }];

        let app = state.lock().await;
        phase2_msgs.extend(app.history.build_ollama_messages(profile_msgs));
        drop(app);

        let mut full_response = String::new();
        let mut token_cb = |tok: String| {
            full_response.push_str(&tok);
        };

        let (final_response, _dirs, _pt, _ot) = match LLMClient::new(&model_name)
            .stream_cli(phase2_msgs, &mut token_cb, profile_temp).await
        {
            Ok(result) => result,
            Err(e) => {
                let mut app = state.lock().await;
                app.thinking = false;
                app.messages.push(ChatMsg {
                    source: "system".to_string(),
                    content: format!("❌ Phase 2 Error: {}", e),
                });
                app.history.append(Message {
                    role: "assistant".to_string(),
                    content: format!("(error generating response: {})", e),
                    thinking: String::new(),
                    timestamp: Utc::now(),
                });
                continue;
            }
        };

        let mut app = state.lock().await;
        app.thinking = false;
        app.current_response = String::new();

        let think_text = extract_thinking(&final_response);
        let clean_resp = strip_thinking(&final_response);

        app.messages.push(ChatMsg {
            source: "assistant".to_string(),
            content: clean_resp.clone(),
        });

        if !tool_results.is_empty() {
            app.messages.push(ChatMsg {
                source: "system".to_string(),
                content: tool_results.join("\n"),
            });
        }

        app.history.append(Message {
            role: "assistant".to_string(),
            content: clean_resp,
            thinking: think_text,
            timestamp: Utc::now(),
        });
    }

    // Shutdown
    let app = state.lock().await;
    app.mcp_mgr.shutdown().await;
    app.daemon_mgr.shutdown().await;
}

fn extract_thinking(content: &str) -> String {
    let mut t = String::new();
    let mut in_think = false;
    let mut i = 0;
    let chars: Vec<char> = content.chars().collect();
    while i < chars.len() {
        if content[i..].starts_with("<thinking>") {
            in_think = true;
            i += 10;
        } else if content[i..].starts_with("</thinking>") {
            in_think = false;
            i += 12;
        } else {
            if in_think { t.push(chars[i]); }
            i += 1;
        }
    }
    t.trim().to_string()
}

fn strip_thinking(content: &str) -> String {
    let mut c = String::new();
    let mut in_think = false;
    let mut i = 0;
    while i < content.len() {
        if content[i..].starts_with("<thinking>") {
            in_think = true;
            i += 10;
        } else if content[i..].starts_with("</thinking>") {
            in_think = false;
            i += 12;
        } else {
            if !in_think { c.push(content[i..].chars().next().unwrap()); }
            i += content[i..].chars().next().unwrap().len_utf8();
        }
    }
    c.trim().to_string()
}
