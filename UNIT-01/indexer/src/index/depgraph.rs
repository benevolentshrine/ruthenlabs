use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::Direction;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tree_sitter::{Parser, Node};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepNode {
    pub path: String,
    pub relative_path: String,
    pub language: String,
    pub exports: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepEdge {
    pub source_path: String,
    pub target_path: String,
    pub symbols: Vec<String>,
}

pub struct DepGraph {
    graph: DiGraph<DepNode, DepEdge>,
    path_to_node: HashMap<String, NodeIndex>,
}

impl DepGraph {
    pub fn new() -> Self {
        Self {
            graph: DiGraph::new(),
            path_to_node: HashMap::new(),
        }
    }

    pub fn add_file(&mut self, path: &str, relative_path: &str, language: &str) {
        if self.path_to_node.contains_key(path) {
            return;
        }
        let exports = extract_exports(path, language);
        let node = DepNode {
            path: path.to_string(),
            relative_path: relative_path.to_string(),
            language: language.to_string(),
            exports,
        };
        let idx = self.graph.add_node(node);
        self.path_to_node.insert(path.to_string(), idx);
    }

    pub fn add_dependencies(&mut self, path: &str, content: &str, language: &str) -> Vec<String> {
        let resolved = resolve_imports(path, content, language);
        let source_idx = match self.path_to_node.get(path) {
            Some(&idx) => idx,
            None => return resolved,
        };

        for target in &resolved {
            if !self.path_to_node.contains_key(target) {
                let rel = target
                    .strip_prefix("/")
                    .unwrap_or(target)
                    .to_string();
                self.add_file(target, &rel, language);
            }
            if let Some(&target_idx) = self.path_to_node.get(target) {
                if !self.graph.contains_edge(source_idx, target_idx) {
                    self.graph.add_edge(
                        source_idx,
                        target_idx,
                        DepEdge {
                            source_path: path.to_string(),
                            target_path: target.clone(),
                            symbols: Vec::new(),
                        },
                    );
                }
            }
        }
        resolved
    }

    pub fn dependents_of(&self, path: &str) -> Vec<String> {
        let idx = match self.path_to_node.get(path) {
            Some(&idx) => idx,
            None => return vec![],
        };
        self.graph
            .neighbors_directed(idx, Direction::Incoming)
            .filter_map(|n| self.graph.node_weight(n))
            .map(|n| n.path.clone())
            .collect()
    }

    pub fn dependencies_of(&self, path: &str) -> Vec<String> {
        let idx = match self.path_to_node.get(path) {
            Some(&idx) => idx,
            None => return vec![],
        };
        self.graph
            .neighbors_directed(idx, Direction::Outgoing)
            .filter_map(|n| self.graph.node_weight(n))
            .map(|n| n.path.clone())
            .collect()
    }

    pub fn transitive_dependents(&self, path: &str) -> Vec<String> {
        let mut visited = HashSet::new();
        let mut result = Vec::new();
        let mut stack = vec![path.to_string()];
        while let Some(current) = stack.pop() {
            let deps = self.dependents_of(&current);
            for dep in deps {
                if visited.insert(dep.clone()) {
                    result.push(dep.clone());
                    stack.push(dep);
                }
            }
        }
        result
    }

    pub fn find_file_by_export(&self, symbol: &str) -> Vec<String> {
        self.graph
            .node_weights()
            .filter(|n| n.exports.iter().any(|e| e.contains(symbol) || symbol.contains(e)))
            .map(|n| n.path.clone())
            .collect()
    }

    pub fn all_nodes(&self) -> Vec<DepNode> {
        self.graph.node_weights().cloned().collect()
    }

    pub fn impact_analysis(&self, path: &str) -> ImpactReport {
        let direct = self.dependents_of(path);
        let transitive = self.transitive_dependents(path);
        ImpactReport {
            target: path.to_string(),
            direct_dependents: direct,
            transitive_dependents: transitive,
            total_impact: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactReport {
    pub target: String,
    pub direct_dependents: Vec<String>,
    pub transitive_dependents: Vec<String>,
    pub total_impact: usize,
}

fn extract_exports(path: &str, language: &str) -> Vec<String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    if let Some((tree, _lang)) = parse_with_ts(&content, language) {
        let root = tree.root_node();
        let source = content.as_bytes();
        match language {
            "Rust" => return extract_rust_exports(&root, source),
            "Python" => return extract_python_exports(&root, source),
            "JavaScript" | "TypeScript" => return extract_js_ts_exports(&root, source),
            "Go" => return extract_go_exports(&root, source),
            _ => {}
        }
    }

    let mut exports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        match language {
            "Rust" => {
                if let Some(name) = trimmed.strip_prefix("pub fn ") {
                    if let Some(name) = name.split('(').next() {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("pub struct ") {
                    if let Some(name) = name.split('<').next().or_else(|| name.split('{').next()) {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("pub enum ") {
                    if let Some(name) = name.split('{').next() {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("pub trait ") {
                    if let Some(name) = name.split('<').next().or_else(|| name.split('{').next()) {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("pub async fn ") {
                    if let Some(name) = name.split('(').next() {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("pub(crate) fn ") {
                    if let Some(name) = name.split('(').next() {
                        exports.push(name.trim().to_string());
                    }
                }
            }
            "Python" => {
                if let Some(name) = trimmed.strip_prefix("def ") {
                    if let Some(name) = name.split('(').next() {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("async def ") {
                    if let Some(name) = name.split('(').next() {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("class ") {
                    if let Some(name) = name.split('(').next().or_else(|| name.split(':').next()) {
                        exports.push(name.trim().to_string());
                    }
                }
            }
            "JavaScript" | "TypeScript" => {
                if let Some(name) = trimmed.strip_prefix("export function ") {
                    if let Some(name) = name.split('(').next().or_else(|| name.split('<').next()) {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("export class ") {
                    if let Some(name) = name.split('{').next().or_else(|| name.split("extends").next()).or_else(|| name.split("implements").next()) {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("export interface ") {
                    if let Some(name) = name.split('{').next().or_else(|| name.split("extends").next()) {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("export const ") {
                    if let Some(name) = name.split('=').next() {
                        exports.push(name.trim().to_string());
                    }
                }
                if let Some(name) = trimmed.strip_prefix("export default ") {
                    let name = name.trim();
                    exports.push(name.to_string());
                }
                if let Some(name) = trimmed.strip_prefix("export async function ") {
                    if let Some(name) = name.split('(').next() {
                        exports.push(name.trim().to_string());
                    }
                }
            }
            "Go" => {
                if let Some(name) = trimmed.strip_prefix("func ") {
                    if name.starts_with(|c: char| c.is_uppercase()) {
                        if let Some(name) = name.split('(').next() {
                            exports.push(name.trim().to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    exports
}

fn resolve_imports(path: &str, content: &str, language: &str) -> Vec<String> {
    let current_dir = Path::new(path).parent().unwrap_or(Path::new("."));
    let mut resolved = Vec::new();

    if let Some((tree, _lang)) = parse_with_ts(content, language) {
        let root = tree.root_node();
        let source = content.as_bytes();
        match language {
            "Rust" => {
                resolve_rust_imports_ts(&root, source, current_dir, &mut resolved);
                return resolved;
            }
            "Python" => {
                resolve_python_imports_ts(&root, source, current_dir, &mut resolved);
                return resolved;
            }
            "JavaScript" | "TypeScript" => {
                resolve_ts_imports_ts(&root, source, current_dir, &mut resolved);
                return resolved;
            }
            "Go" => {
                resolve_go_imports_ts(&root, source, current_dir, &mut resolved);
                return resolved;
            }
            _ => {}
        }
    }

    match language {
        "Rust" => resolve_rust_imports(content, current_dir, &mut resolved),
        "Python" => resolve_python_imports(content, current_dir, &mut resolved),
        "JavaScript" | "TypeScript" => resolve_ts_imports(content, current_dir, &mut resolved),
        "Go" => resolve_go_imports(content, current_dir, &mut resolved),
        "Java" => resolve_java_imports(content, current_dir, &mut resolved),
        "C" | "C++" => resolve_c_imports(content, current_dir, &mut resolved),
        _ => {}
    }

    resolved
}

fn resolve_rust_imports(content: &str, current_dir: &Path, resolved: &mut Vec<String>) {
    let re = Regex::new(r"^(?:use\s+)([\w:]+)").unwrap();
    for line in content.lines() {
        if let Some(caps) = re.captures(line.trim()) {
            let import_path = caps.get(1).unwrap().as_str();
            let parts: Vec<&str> = import_path.split("::").collect();
            if parts.len() >= 2 {
                let crate_name = parts[0];
                if crate_name == "crate" {
                    let file_path = format!("src/{}.rs", parts[1..].join("/"));
                    resolved.push(file_path);
                } else if crate_name.starts_with(|c: char| c.is_lowercase()) {
                    resolved.push(crate_name.replace('-', "_") + ".rs");
                }
            }
        }
        if let Some(mod_name) = line.trim().strip_prefix("mod ") {
            if let Some(name) = mod_name.split(';').next() {
                let name = name.trim().trim_matches('"');
                let candidate = current_dir.join(format!("{}.rs", name));
                if candidate.exists() {
                    resolved.push(candidate.to_string_lossy().to_string());
                }
                let dir_candidate = current_dir.join(name).join("mod.rs");
                if dir_candidate.exists() {
                    resolved.push(dir_candidate.to_string_lossy().to_string());
                }
            }
        }
    }
}

fn resolve_python_imports(content: &str, current_dir: &Path, resolved: &mut Vec<String>) {
    let re_import = Regex::new(r"^import\s+(\w+(?:\.\w+)*)").unwrap();
    let re_from = Regex::new(r"^from\s+(\w+(?:\.\w+)*)\s+import").unwrap();
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(caps) = re_import.captures(trimmed) {
            let module = caps.get(1).unwrap().as_str().replace('.', "/");
            let candidate = current_dir.join(format!("{}.py", module));
            if candidate.exists() {
                resolved.push(candidate.to_string_lossy().to_string());
            }
        }
        if let Some(caps) = re_from.captures(trimmed) {
            let module = caps.get(1).unwrap().as_str().replace('.', "/");
            let candidate = current_dir.join(format!("{}.py", module));
            if candidate.exists() {
                resolved.push(candidate.to_string_lossy().to_string());
            }
            let init_candidate = current_dir.join(&module).join("__init__.py");
            if init_candidate.exists() {
                resolved.push(init_candidate.to_string_lossy().to_string());
            }
        }
        if trimmed.starts_with("import ") || trimmed.starts_with("from ") {
            continue;
        }
    }
}

fn resolve_ts_imports(content: &str, current_dir: &Path, resolved: &mut Vec<String>) {
    let re = Regex::new(r#"(?:import|require)\s*\(?\s*['"]([^'"]+)['"]"#).unwrap();
    for line in content.lines() {
        if let Some(caps) = re.captures(line.trim()) {
            let raw = caps.get(1).unwrap().as_str();
            if raw.starts_with('.') {
                let mut base = current_dir.join(raw);
                try_resolve_ts_path(&mut base, resolved);
            }
        }
    }
}

fn try_resolve_ts_path(base: &mut PathBuf, resolved: &mut Vec<String>) {
    for ext in &["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"] {
        let _candidate = base.with_extension(ext.trim_start_matches('.'));
        let candidate_str = if ext.starts_with('/') {
            let mut p = base.clone();
            p.push(&ext[1..]);
            p
        } else if ext.is_empty() {
            base.clone()
        } else {
            base.with_extension(&ext[1..])
        };
        if candidate_str.exists() && !resolved.contains(&candidate_str.to_string_lossy().to_string()) {
            resolved.push(candidate_str.to_string_lossy().to_string());
        }
    }
}

fn resolve_go_imports(content: &str, current_dir: &Path, resolved: &mut Vec<String>) {
    let re = Regex::new(r#""([^"]+)""#).unwrap();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import") || trimmed.starts_with("\t\"") {
            if let Some(caps) = re.captures(trimmed) {
                let import_path = caps.get(1).unwrap().as_str();
                let parts: Vec<&str> = import_path.split('/').collect();
                if let Some(local) = parts.last() {
                    let candidate = current_dir.join(format!("{}.go", local));
                    if candidate.exists() {
                        resolved.push(candidate.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
}

fn resolve_java_imports(content: &str, _current_dir: &Path, resolved: &mut Vec<String>) {
    let re = Regex::new(r"^import\s+([\w.]+);").unwrap();
    for line in content.lines() {
        if let Some(caps) = re.captures(line.trim()) {
            let import_path = caps.get(1).unwrap().as_str();
            let file = import_path.replace('.', "/") + ".java";
            resolved.push(file);
        }
    }
}

fn resolve_c_imports(content: &str, current_dir: &Path, resolved: &mut Vec<String>) {
    let re = Regex::new(r#"#include\s+"([^"]+)""#).unwrap();
    for line in content.lines() {
        if let Some(caps) = re.captures(line.trim()) {
            let include_path = caps.get(1).unwrap().as_str();
            let candidate = current_dir.join(include_path);
            if candidate.exists() {
                resolved.push(candidate.to_string_lossy().to_string());
            }
        }
    }
}

impl Default for DepGraph {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_with_ts(content: &str, language: &str) -> Option<(tree_sitter::Tree, tree_sitter::Language)> {
    let mut parser = Parser::new();
    let lang: tree_sitter::Language = match language {
        "Rust" => tree_sitter_rust::LANGUAGE.into(),
        "Python" => tree_sitter_python::LANGUAGE.into(),
        "JavaScript" => tree_sitter_javascript::LANGUAGE.into(),
        "TypeScript" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "Go" => tree_sitter_go::LANGUAGE.into(),
        _ => return None,
    };
    parser.set_language(&lang).ok()?;
    let tree = parser.parse(content, None)?;
    Some((tree, lang))
}

fn get_node_text<'a>(node: &Node<'a>, source: &'a [u8]) -> Option<&'a str> {
    node.utf8_text(source).ok()
}

fn find_child_by_type<'a>(node: &Node<'a>, node_type: &str) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == node_type {
            return Some(child);
        }
    }
    None
}

fn is_rust_public(node: &Node, source: &[u8]) -> bool {
    if let Some(vis) = find_child_by_type(node, "visibility_modifier") {
        if let Some(text) = get_node_text(&vis, source) {
            return text.starts_with("pub");
        }
    }
    false
}

fn extract_rust_exports(root: &Node, source: &[u8]) -> Vec<String> {
    let mut exports = Vec::new();
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "function_item" => {
                if is_rust_public(&node, source) {
                    if let Some(id_node) = find_child_by_type(&node, "identifier") {
                        if let Some(name) = get_node_text(&id_node, source) {
                            exports.push(name.to_string());
                        }
                    }
                }
            }
            "struct_item" | "enum_item" | "trait_item" => {
                if is_rust_public(&node, source) {
                    if let Some(id_node) = find_child_by_type(&node, "type_identifier")
                        .or_else(|| find_child_by_type(&node, "identifier"))
                    {
                        if let Some(name) = get_node_text(&id_node, source) {
                            exports.push(name.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    exports
}

fn extract_python_exports(root: &Node, source: &[u8]) -> Vec<String> {
    let mut exports = Vec::new();
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "function_definition" | "class_definition" => {
                if let Some(id_node) = find_child_by_type(&node, "identifier") {
                    if let Some(name) = get_node_text(&id_node, source) {
                        exports.push(name.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    exports
}

fn extract_go_exports(root: &Node, source: &[u8]) -> Vec<String> {
    let mut exports = Vec::new();
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "function_declaration" => {
                if let Some(id_node) = find_child_by_type(&node, "identifier") {
                    if let Some(name) = get_node_text(&id_node, source) {
                        if name.starts_with(|c: char| c.is_uppercase()) {
                            exports.push(name.to_string());
                        }
                    }
                }
            }
            "type_declaration" => {
                let mut spec_cursor = node.walk();
                for spec in node.children(&mut spec_cursor) {
                    if spec.kind() == "type_spec" {
                        if let Some(id_node) = find_child_by_type(&spec, "type_identifier") {
                            if let Some(name) = get_node_text(&id_node, source) {
                                if name.starts_with(|c: char| c.is_uppercase()) {
                                    exports.push(name.to_string());
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    exports
}

fn extract_js_ts_exports(root: &Node, source: &[u8]) -> Vec<String> {
    let mut exports = Vec::new();
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        if node.kind() == "export_statement" {
            let mut is_default = false;
            let mut sub_cursor = node.walk();
            for child in node.children(&mut sub_cursor) {
                if child.kind() == "default" {
                    is_default = true;
                }
            }

            let mut found_decl = false;
            for child in node.children(&mut sub_cursor) {
                match child.kind() {
                    "function_declaration" | "generator_function_declaration" => {
                        if let Some(id_node) = find_child_by_type(&child, "identifier") {
                            if let Some(name) = get_node_text(&id_node, source) {
                                exports.push(name.to_string());
                                found_decl = true;
                            }
                        }
                    }
                    "class_declaration" => {
                        if let Some(id_node) = find_child_by_type(&child, "type_identifier")
                            .or_else(|| find_child_by_type(&child, "identifier"))
                        {
                            if let Some(name) = get_node_text(&id_node, source) {
                                exports.push(name.to_string());
                                found_decl = true;
                            }
                        }
                    }
                    "interface_declaration" | "type_alias_declaration" => {
                        if let Some(id_node) = find_child_by_type(&child, "type_identifier") {
                            if let Some(name) = get_node_text(&id_node, source) {
                                exports.push(name.to_string());
                                found_decl = true;
                            }
                        }
                    }
                    "enum_declaration" => {
                        if let Some(id_node) = find_child_by_type(&child, "identifier") {
                            if let Some(name) = get_node_text(&id_node, source) {
                                exports.push(name.to_string());
                                found_decl = true;
                            }
                        }
                    }
                    "lexical_declaration" | "variable_declaration" => {
                        let mut dec_cursor = child.walk();
                        for dec in child.children(&mut dec_cursor) {
                            if dec.kind() == "variable_declarator" {
                                if let Some(id_node) = find_child_by_type(&dec, "identifier") {
                                    if let Some(name) = get_node_text(&id_node, source) {
                                        exports.push(name.to_string());
                                        found_decl = true;
                                    }
                                }
                            }
                        }
                    }
                    "export_clause" => {
                        let mut clause_cursor = child.walk();
                        for spec in child.children(&mut clause_cursor) {
                            if spec.kind() == "export_specifier" {
                                let identifiers: Vec<Node> = spec
                                    .children(&mut spec.walk())
                                    .filter(|c| c.kind() == "identifier")
                                    .collect();
                                if let Some(last_id) = identifiers.last() {
                                    if let Some(name) = get_node_text(last_id, source) {
                                        exports.push(name.to_string());
                                        found_decl = true;
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }

            if is_default && !found_decl {
                let mut expression_node = None;
                for child in node.children(&mut sub_cursor) {
                    if child.kind() != "export" && child.kind() != "default" && child.kind() != ";" {
                        expression_node = Some(child);
                        break;
                    }
                }
                if let Some(expr) = expression_node {
                    if expr.kind() == "identifier" || expr.kind() == "type_identifier" {
                        if let Some(name) = get_node_text(&expr, source) {
                            exports.push(name.to_string());
                        }
                    } else {
                        exports.push("default".to_string());
                    }
                } else {
                    exports.push("default".to_string());
                }
            }
        }
    }
    exports
}

fn resolve_rust_imports_ts(root: &Node, source: &[u8], current_dir: &Path, resolved: &mut Vec<String>) {
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "use_declaration" => {
                let mut path_node = None;
                let mut sub_cursor = node.walk();
                for child in node.children(&mut sub_cursor) {
                    if child.kind() != "use" && child.kind() != ";" {
                        path_node = Some(child);
                        break;
                    }
                }
                if let Some(path_node) = path_node {
                    if let Some(text) = get_node_text(&path_node, source) {
                        let clean_text = if let Some(idx) = text.find('{') {
                            &text[..idx]
                        } else {
                            text
                        };
                        let clean_text = clean_text.trim_end_matches("::");
                        let parts: Vec<&str> = clean_text.split("::").collect();
                        if parts.len() >= 2 {
                            let crate_name = parts[0].trim();
                            if crate_name == "crate" {
                                let file_path = format!("src/{}.rs", parts[1..].join("/"));
                                resolved.push(file_path);
                            } else if crate_name.starts_with(|c: char| c.is_lowercase()) {
                                resolved.push(crate_name.replace('-', "_") + ".rs");
                            }
                        }
                    }
                }
            }
            "mod_item" => {
                let has_body = find_child_by_type(&node, "declaration_list").is_some();
                if !has_body {
                    if let Some(id_node) = find_child_by_type(&node, "identifier") {
                        if let Some(name) = get_node_text(&id_node, source) {
                            let name = name.trim().trim_matches('"');
                            let candidate = current_dir.join(format!("{}.rs", name));
                            if candidate.exists() {
                                resolved.push(candidate.to_string_lossy().to_string());
                            }
                            let dir_candidate = current_dir.join(name).join("mod.rs");
                            if dir_candidate.exists() {
                                resolved.push(dir_candidate.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn resolve_python_imports_ts(root: &Node, source: &[u8], current_dir: &Path, resolved: &mut Vec<String>) {
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "import_statement" => {
                let mut sub_cursor = node.walk();
                for child in node.children(&mut sub_cursor) {
                    if child.kind() == "dotted_name" {
                        if let Some(text) = get_node_text(&child, source) {
                            let module = text.replace('.', "/");
                            let candidate = current_dir.join(format!("{}.py", module));
                            if candidate.exists() {
                                resolved.push(candidate.to_string_lossy().to_string());
                            }
                        }
                    } else if child.kind() == "aliased_import" {
                        if let Some(dotted) = find_child_by_type(&child, "dotted_name") {
                            if let Some(text) = get_node_text(&dotted, source) {
                                let module = text.replace('.', "/");
                                let candidate = current_dir.join(format!("{}.py", module));
                                if candidate.exists() {
                                    resolved.push(candidate.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
            "import_from_statement" => {
                let mut sub_cursor = node.walk();
                let mut module_path = String::new();
                for child in node.children(&mut sub_cursor) {
                    if child.kind() == "dotted_name" {
                        if let Some(text) = get_node_text(&child, source) {
                            module_path = text.replace('.', "/");
                        }
                    }
                }
                if !module_path.is_empty() {
                    let candidate = current_dir.join(format!("{}.py", module_path));
                    if candidate.exists() {
                        resolved.push(candidate.to_string_lossy().to_string());
                    }
                    let init_candidate = current_dir.join(&module_path).join("__init__.py");
                    if init_candidate.exists() {
                        resolved.push(init_candidate.to_string_lossy().to_string());
                    }
                }
            }
            _ => {}
        }
    }
}

fn resolve_ts_imports_ts(root: &Node, source: &[u8], current_dir: &Path, resolved: &mut Vec<String>) {
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        match node.kind() {
            "import_statement" | "export_statement" => {
                let mut sub_cursor = node.walk();
                for child in node.children(&mut sub_cursor) {
                    if child.kind() == "string" {
                        if let Some(text) = get_node_text(&child, source) {
                            let raw = text.trim_matches(|c| c == '\'' || c == '"');
                            if raw.starts_with('.') {
                                let mut base = current_dir.join(raw);
                                try_resolve_ts_path(&mut base, resolved);
                            }
                        }
                    }
                }
            }
            _ => {
                resolve_js_ts_calls_recursive(&node, source, current_dir, resolved);
            }
        }
    }
}

fn resolve_js_ts_calls_recursive(node: &Node, source: &[u8], current_dir: &Path, resolved: &mut Vec<String>) {
    if node.kind() == "call_expression" {
        if let Some(func) = find_child_by_type(node, "identifier") {
            if let Some(func_name) = get_node_text(&func, source) {
                if func_name == "require" {
                    if let Some(args) = find_child_by_type(node, "arguments") {
                        let mut sub_cursor = args.walk();
                        for child in args.children(&mut sub_cursor) {
                            if child.kind() == "string" {
                                if let Some(text) = get_node_text(&child, source) {
                                    let raw = text.trim_matches(|c| c == '\'' || c == '"');
                                    if raw.starts_with('.') {
                                        let mut base = current_dir.join(raw);
                                        try_resolve_ts_path(&mut base, resolved);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        resolve_js_ts_calls_recursive(&child, source, current_dir, resolved);
    }
}

fn resolve_go_imports_ts(root: &Node, source: &[u8], current_dir: &Path, resolved: &mut Vec<String>) {
    let mut cursor = root.walk();
    for node in root.children(&mut cursor) {
        if node.kind() == "import_declaration" {
            let mut sub_cursor = node.walk();
            for child in node.children(&mut sub_cursor) {
                if child.kind() == "import_spec" {
                    if let Some(path_node) = find_child_by_type(&child, "import_path") {
                        if let Some(text) = get_node_text(&path_node, source) {
                            let import_path = text.trim_matches('"');
                            let parts: Vec<&str> = import_path.split('/').collect();
                            if let Some(local) = parts.last() {
                                let candidate = current_dir.join(format!("{}.go", local));
                                if candidate.exists() {
                                    resolved.push(candidate.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                } else if child.kind() == "import_spec_list" {
                    let mut list_cursor = child.walk();
                    for spec in child.children(&mut list_cursor) {
                        if spec.kind() == "import_spec" {
                            if let Some(path_node) = find_child_by_type(&spec, "import_path") {
                                if let Some(text) = get_node_text(&path_node, source) {
                                    let import_path = text.trim_matches('"');
                                    let parts: Vec<&str> = import_path.split('/').collect();
                                    if let Some(local) = parts.last() {
                                        let candidate = current_dir.join(format!("{}.go", local));
                                        if candidate.exists() {
                                            resolved.push(candidate.to_string_lossy().to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_extract_exports_rust() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            "pub fn my_pub_func() {{}}\n\
             fn private_func() {{}}\n\
             pub struct MyStruct;\n\
             pub enum MyEnum {{}}\n\
             pub trait MyTrait {{}}"
        )
        .unwrap();

        let exports = extract_exports(file.path().to_str().unwrap(), "Rust");
        assert!(exports.contains(&"my_pub_func".to_string()));
        assert!(exports.contains(&"MyStruct".to_string()));
        assert!(exports.contains(&"MyEnum".to_string()));
        assert!(exports.contains(&"MyTrait".to_string()));
        assert!(!exports.contains(&"private_func".to_string()));
    }

    #[test]
    fn test_extract_exports_python() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            "def my_func():\n\
                 pass\n\
             class MyClass:\n\
                 pass"
        )
        .unwrap();

        let exports = extract_exports(file.path().to_str().unwrap(), "Python");
        assert!(exports.contains(&"my_func".to_string()));
        assert!(exports.contains(&"MyClass".to_string()));
    }

    #[test]
    fn test_extract_exports_js_ts() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            "export function myFunc() {{}}\n\
             export class MyClass {{}}\n\
             export const myConst = 42;\n\
             export default myDefault;"
        )
        .unwrap();

        let exports = extract_exports(file.path().to_str().unwrap(), "TypeScript");
        println!("TypeScript Exports: {:?}", exports);
        assert!(exports.contains(&"myFunc".to_string()));
        assert!(exports.contains(&"MyClass".to_string()));
        assert!(exports.contains(&"myConst".to_string()));
        assert!(exports.contains(&"myDefault".to_string()));
    }

    #[test]
    fn test_resolve_imports_rust() {
        let content = "use crate::foo::bar;\nuse crate::utils::{{a, b}};";
        let resolved = resolve_imports("src/main.rs", content, "Rust");
        println!("Rust Resolved: {:?}", resolved);
        assert!(resolved.contains(&"src/foo/bar.rs".to_string()));
        assert!(resolved.contains(&"src/utils.rs".to_string()));
    }
}
