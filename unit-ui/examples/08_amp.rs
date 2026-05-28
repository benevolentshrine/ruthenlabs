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
        .accent(Color::Rgb(255, 100, 100))
        .text(Color::Rgb(230, 220, 220))
        .text_dim(Color::Rgb(120, 110, 110))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(26, 20, 20))
        .thinking(Color::Rgb(200, 180, 80))
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

    let diff_text = "@@ -20,8 +20,10 @@\n class UserAuth:\n     def authenticate(self, token):\n-        return self.db.verify(token)\n+        if not token:\n+            raise ValueError(\"empty token\")\n+        result = self.db.verify(token)\n+        return result";

    let entries = [
        TimelineEntry::new("13:10:01", "🔍", "code_intel", "traced authenticate()"),
        TimelineEntry::new("13:10:03", "📊", "symbols", "14 references found"),
        TimelineEntry::new("13:10:05", "✏️", "suggest", "add input validation"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, left, right, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(10), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(left);

            let bar = StatusBar::new().provider("Amp").model("sourcegraph")
                .connection(ConnectionStatus::Connected).started_at(started)
                .model("repo-wide context").style(s.clone());
            f.render_widget(&bar, top);

            let diff_block = Block::default().borders(Borders::ALL).title(" Suggested Changes ").border_style(Style::default().fg(s.accent));
            let diff_inner = diff_block.inner(chunks[0]);
            f.render_widget(&diff_block, chunks[0]);
            f.render_widget(DiffView::new().diff(diff_text).file("auth/user.py").style(s.clone()), diff_inner);

            let block = Block::default().borders(Borders::ALL).title(" Context Timeline ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(chunks[1]);
            f.render_widget(&block, chunks[1]);
            f.render_widget(SessionTimeline::new().entries(&entries).style(s.clone()), inner);

            let tb = ThinkingBlock::new().label("Code intelligence")
                .state(ThinkingState::Thinking).expanded(true)
                .frame_index(frame as usize)
                .elapsed(std::time::Duration::from_millis(frame * 40))
                .content("Sourcegraph analysis:\n- authenticate() called from 3 endpoints\n- Missing input validation\n- Security risk: empty token accepted")
                .style(s.clone());
            f.render_widget(&tb, right);

            let card = ToolCallCard::new().tool_name("code_intel")
                .arguments("{\"symbol\": \"UserAuth.authenticate\", \"scope\": \"repo\"}")
                .status(ToolStatus::Success).duration(std::time::Duration::from_secs(2))
                .result("14 references, 3 call sites, 1 security issue")
                .style(s.clone());
            let card_area = ratatui::layout::Rect { x: input_area.x, y: input_area.y.saturating_sub(5), width: input_area.width, height: 5 };
            f.render_widget(&card, card_area);

            let input_w = BasicInput::new(&input).placeholder("Ask about your codebase...").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Char(c) => input.push(c),
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
