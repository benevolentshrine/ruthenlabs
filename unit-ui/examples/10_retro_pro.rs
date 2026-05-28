use std::io::stdout;
use std::time::{Duration, Instant};

use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(0, 220, 0))
        .text(Color::Rgb(0, 200, 0))
        .text_dim(Color::Rgb(0, 140, 0))
        .success(Color::Rgb(0, 255, 0))
        .surface(Color::Rgb(0, 0, 0))
        .thinking(Color::Rgb(0, 200, 100))
        .error(Color::Rgb(200, 0, 0))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame = 0u64;
    let mut input_text = String::new();
    let messages = [
        ("root@retro:~$ scan network 10.0.0.0/24", Role::User),
        ("[INIT] Starting reconnaissance on 10.0.0.0/24...\n[SCAN] 256 hosts, 6 open ports found\n[ANALYZE] 3 targets identified", Role::Assistant),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(Color::Black);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [top, chat, tools, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(2), Constraint::Length(5), Constraint::Length(3),
            ]).areas(area);

            let bar = StatusBar::new().provider("root@retro").model("nexus-7")
                .connection(ConnectionStatus::Connected).started_at(started)
                .token_count(frame).style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(chat);
            f.render_widget(&block, chat);

            let mut y = inner.y + 1;
            for &(content, role) in &messages {
                let h = content.lines().count() as u16 + 2;
                if y + h > inner.bottom() { break; }
                f.render_widget(
                    MessageBubble::new(content, role).style(s.clone()),
                    Rect { x: inner.x + 1, y, width: inner.width.saturating_sub(2), height: h },
                );
                y += h + 1;
            }

            let chunks = Layout::horizontal([Constraint::Ratio(1, 2), Constraint::Ratio(1, 2)]).split(tools);
            let tb_area = chunks[0];
            let tc_area = if tools.width > 40 { chunks[1] } else { Rect::default() };

            let tb = ThinkingBlock::new().label("Analyzing subnet")
                .state(ThinkingState::Thinking).expanded(true)
                .frame_index(frame as usize).elapsed(Duration::from_millis(frame * 40))
                .content("Probing 10.0.0.1..10.0.0.254\n6 ports open on 3 hosts")
                .style(s.clone());
            f.render_widget(&tb, tb_area);

            let card = ToolCallCard::new().tool_name("nmap_scan")
                .arguments("{\"target\": \"10.0.0.0/24\", \"ports\": \"22,80,443,8080\"}")
                .status(ToolStatus::Running).duration(Duration::from_secs(frame / 10))
                .result("3 hosts up\n6 open ports discovered")
                .style(s.clone());
            f.render_widget(&card, tc_area);

            f.render_widget(BasicInput::new(&input_text).placeholder("root@retro:~$ ").style(s.clone()), bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Char(c) => input_text.push(c),
                    crossterm::event::KeyCode::Enter => { input_text.clear(); }
                    crossterm::event::KeyCode::Backspace => { input_text.pop(); }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
