use std::io::stdout;
use std::time::Instant;

use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(100, 200, 100))
        .text(Color::Rgb(220, 230, 220))
        .text_dim(Color::Rgb(110, 130, 110))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(20, 26, 20))
        .thinking(Color::Rgb(180, 180, 80))
        .error(Color::Rgb(220, 60, 60))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame = 0u64;
    let mut input = String::new();
    let mut show_menu = false;

    let diff_text = "@@ -5,4 +5,6 @@\n def calculate(items):\n-    return sum(items)\n+    validated = [i for i in items if i > 0]\n+    return sum(validated)";

    let commands = [
        SlashCommand::new("add", "Add files to chat"),
        SlashCommand::new("drop", "Remove files from chat"),
        SlashCommand::new("commit", "Commit changes"),
        SlashCommand::new("diff", "Show diff"),
        SlashCommand::new("undo", "Undo last change"),
        SlashCommand::new("architect", "Enter architect mode"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, left, right, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(8), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(45), Constraint::Percentage(55)]).split(left);

            let bar = StatusBar::new().provider("Aider").model("claude-sonnet")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let bubble = MessageBubble::new("Aider — git-native pair programmer\nType /architect for planning mode\nAuto-commits with descriptive messages", Role::Assistant).style(s.clone());
            f.render_widget(&bubble, chunks[0]);

            let tb = ThinkingBlock::new().label("Architect mode")
                .state(ThinkingState::Thinking).expanded(true)
                .frame_index(frame as usize)
                .elapsed(std::time::Duration::from_millis(frame * 40))
                .content("Planning refactor of calculate():\n1. Add input validation\n2. Filter negative values\n3. Update tests")
                .style(s.clone());
            f.render_widget(&tb, chunks[1]);

            let diff_block = Block::default().borders(Borders::ALL).title(" Git Diff ").border_style(Style::default().fg(s.success));
            let diff_inner = diff_block.inner(right);
            f.render_widget(&diff_block, right);
            f.render_widget(DiffView::new().diff(diff_text).file("utils.py").style(s.clone()), diff_inner);

            if show_menu {
                let menu = SlashMenu::new(&commands).style(s.clone());
                let menu_area = ratatui::layout::Rect { x: input_area.x, y: input_area.y.saturating_sub(6), width: 30, height: 7 };
                f.render_widget(&menu, menu_area);
            }

            let input_w = BasicInput::new(&input).placeholder("/ for commands, or describe changes...").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Char('/') => { show_menu = !show_menu; }
                    crossterm::event::KeyCode::Char(c) => { input.push(c); show_menu = false; }
                    crossterm::event::KeyCode::Backspace => { input.pop(); }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
