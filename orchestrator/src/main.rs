mod socket;

use std::sync::Arc;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

use iocraft::prelude::*;

// ─── Chat message model ────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct ChatMessage {
    source: String,
    content: String,
}

// ─── Application component ─────────────────────────────────────────────────

#[derive(Default, Props)]
struct ChatAppProps {
    rx: Option<UnboundedReceiver<socket::SiblingMessage>>,
}

#[component]
fn ChatApp(props: &mut ChatAppProps, mut hooks: Hooks) -> impl Into<AnyElement<'static>> {
    let messages = hooks.use_state(|| Vec::<ChatMessage>::new());
    let mut input_text = hooks.use_state(|| String::new());


    // Store the receiver in a use_ref so it lives across renders.
    let rx = hooks.use_ref(|| {
        Arc::new(tokio::sync::Mutex::new(
            props.rx.take().expect("ChatApp requires a receiver"),
        ))
    });

    // ── Background UDS listener via use_future ──────────────────────────
    let mut messages_for_future = messages.clone();
    hooks.use_future(async move {
        let rx_arc = rx.read().clone();
        loop {
            let msg = rx_arc.lock().await.recv().await;
            match msg {
                Some(msg) => {
                    let content = msg
                        .payload
                        .get("content")
                        .or_else(|| msg.payload.get("text"))
                        .or_else(|| msg.payload.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    if content.is_empty() {
                        continue;
                    }

                    let mut current = messages_for_future.read().clone();
                    if let Some(last) = current.last_mut() {
                        if last.source == msg.source {
                            last.content.push_str(&content);
                            messages_for_future.set(current);
                            continue;
                        }
                    }
                    current.push(ChatMessage {
                        source: msg.source,
                        content,
                    });
                    messages_for_future.set(current);
                }
                None => break,
            }
        }
    });

    // ── Handle keyboard events ─────────────────────────────────────────
    let mut input_for_events = input_text.clone();
    let mut messages_for_events = messages.clone();
    hooks.use_terminal_events({
        move |event| {
            if let TerminalEvent::Key(KeyEvent { code, kind, .. }) = event {
                if kind == KeyEventKind::Press {
                    match code {
                        KeyCode::Enter => {
                            let text = input_for_events.read().clone();
                            if !text.is_empty() {
                                let mut msgs = messages_for_events.read().clone();
                                msgs.push(ChatMessage {
                                    source: "user".to_string(),
                                    content: text,
                                });
                                messages_for_events.set(msgs);
                                input_for_events.set(String::new());
                            }
                        }
                        KeyCode::Char('c') if input_for_events.read().is_empty() => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    // ── Render the UI ──────────────────────────────────────────────────
    element! {
        View(
            flex_direction: FlexDirection::Column,
            width: 100.0pct,
            height: 100.0pct,
        ) {
            // Header
            View(
                background_color: Some(Color::Rgb { r: 20, g: 20, b: 20 }),
                padding: 12,
            ) {
                Text(
                    content: "AI Agent Orchestrator".to_string(),
                    color: Color::White,
                    weight: Weight::Bold,
                )
            }

            // Scrollable chat history
            View(
                flex_grow: 1.0,
                background_color: Some(Color::Rgb { r: 25, g: 25, b: 25 }),
                padding: 12,
            ) {
                ScrollView {
                    View(
                        flex_direction: FlexDirection::Column,
                        gap: 8,
                    ) {
                        #(messages.read().iter().map(|msg| {
                            let align = if msg.source == "user" { AlignItems::End } else { AlignItems::Start };
                            let bg = if msg.source == "user" { Color::Rgb { r: 0, g: 122, b: 255 } }
                                else if msg.source == "sandbox" { Color::Rgb { r: 40, g: 40, b: 40 } }
                                else if msg.source == "indexer" { Color::Rgb { r: 55, g: 55, b: 55 } }
                                else { Color::Rgb { r: 60, g: 60, b: 60 } };
                            element! {
                                View(align_items: align) {
                                    View(background_color: Some(bg), padding: 8) {
                                        Text(content: msg.content.clone(), color: Color::White)
                                    }
                                }
                            }
                        }))
                    }
                }
            }

            // Input area at the bottom
            View(
                background_color: Some(Color::Rgb { r: 30, g: 30, b: 30 }),
                padding: 12,
            ) {
                View(
                    background_color: Some(Color::Rgb { r: 40, g: 40, b: 40 }),
                    padding: 10,
                ) {
                    TextInput(
                        has_focus: true,
                        value: input_text.read().clone(),
                        on_change: move |new_value| input_text.set(new_value),
                    )
                }
            }
        }
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let (tx, rx) = unbounded_channel::<socket::SiblingMessage>();

    tokio::spawn(async move {
        socket::run_uds_listener(tx).await;
    });

    element! {
        ChatApp(rx: Some(rx))
    }
    .render_loop()
    .await
    .unwrap();
}
