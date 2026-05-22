use std::io::{self, Write};
use crate::models::FileRecord;
use serde_json;

pub trait Formatter {
    fn format_record(&self, record: &FileRecord, writer: &mut dyn Write) -> io::Result<()>;
    fn start_output(&self, writer: &mut dyn Write) -> io::Result<()>;
    fn end_output(&self, writer: &mut dyn Write) -> io::Result<()>;
}

pub struct JsonFormatter;
impl Formatter for JsonFormatter {
    fn start_output(&self, writer: &mut dyn Write) -> io::Result<()> {
        writer.write_all(b"[\n")
    }

    fn format_record(&self, record: &FileRecord, writer: &mut dyn Write) -> io::Result<()> {
        let json = serde_json::to_string(record)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        writer.write_all(json.as_bytes())
    }

    fn end_output(&self, writer: &mut dyn Write) -> io::Result<()> {
        writer.write_all(b"\n]")
    }
}

pub struct NdJsonFormatter;
impl Formatter for NdJsonFormatter {
    fn start_output(&self, _writer: &mut dyn Write) -> io::Result<()> {
        Ok(())
    }

    fn format_record(&self, record: &FileRecord, writer: &mut dyn Write) -> io::Result<()> {
        let json = serde_json::to_string(record)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        writer.write_all(json.as_bytes())?;
        writer.write_all(b"\n")
    }

    fn end_output(&self, _writer: &mut dyn Write) -> io::Result<()> {
        Ok(())
    }
}
