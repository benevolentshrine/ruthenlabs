import pc from 'picocolors'
import { vw, wrap } from './util/ansi.js'

interface LangSyntax {
  keywords: Set<string>
  builtins: Set<string>
  commentChars: string[]
  stringDelimiters: string[]
}

const KEYWORDS: Record<string, string[]> = {
  javascript: [
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
    'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'yield', 'from', 'as',
    'true', 'false', 'null', 'undefined', 'enum', 'implements', 'interface',
    'package', 'private', 'protected', 'public',
  ],
  typescript: [
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
    'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'yield', 'from', 'as',
    'true', 'false', 'null', 'undefined', 'enum', 'implements', 'interface',
    'package', 'private', 'protected', 'public', 'type', 'declare', 'abstract',
    'readonly', 'keyof', 'never', 'satisfies',
  ],
  python: [
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
    'try', 'while', 'with', 'yield',
  ],
  go: [
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
    'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if',
    'import', 'interface', 'map', 'package', 'range', 'return',
    'select', 'struct', 'switch', 'type', 'var',
    'true', 'false', 'nil', 'iota',
  ],
  rust: [
    'as', 'break', 'const', 'continue', 'crate', 'else', 'enum',
    'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let',
    'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
    'self', 'Self', 'static', 'struct', 'super', 'trait', 'true',
    'type', 'unsafe', 'use', 'where', 'while', 'async', 'await',
    'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro',
    'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield',
  ],
  java: [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
    'char', 'class', 'const', 'continue', 'default', 'do', 'double',
    'else', 'enum', 'extends', 'final', 'finally', 'float', 'for',
    'goto', 'if', 'implements', 'import', 'instanceof', 'int',
    'interface', 'long', 'native', 'new', 'package', 'private',
    'protected', 'public', 'return', 'short', 'static', 'strictfp',
    'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while', 'true', 'false',
    'null', 'var', 'record', 'sealed', 'permits', 'yield',
  ],
  c_cpp: [
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default',
    'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto',
    'if', 'inline', 'int', 'long', 'register', 'return', 'short',
    'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef',
    'union', 'unsigned', 'void', 'volatile', 'while', 'true', 'false',
    'nullptr', 'NULL', 'class', 'namespace', 'using', 'template',
    'typename', 'virtual', 'override', 'public', 'private', 'protected',
    'friend', 'operator', 'new', 'delete', 'throw', 'try', 'catch',
    'constexpr', 'const_cast', 'static_cast', 'dynamic_cast',
    'reinterpret_cast', 'explicit', 'export', 'mutable', 'this',
  ],
  bash: [
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until',
    'do', 'done', 'in', 'case', 'esac', 'function', 'return',
    'local', 'export', 'source', 'echo', 'exit', 'read', 'set',
    'unset', 'declare', 'typeset', 'select', 'shift', 'continue',
    'break', 'trap', 'exec', 'eval', 'let', 'time',
  ],
  sql: [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE',
    'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX',
    'VIEW', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS',
    'ON', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN',
    'EXISTS', 'UNION', 'ALL', 'DISTINCT', 'ORDER', 'BY', 'GROUP',
    'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC', 'AS', 'CASE',
    'WHEN', 'THEN', 'ELSE', 'END', 'BEGIN', 'COMMIT', 'ROLLBACK',
    'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT',
    'DEFAULT', 'CHECK', 'UNIQUE', 'INT', 'INTEGER', 'VARCHAR',
    'TEXT', 'BOOLEAN', 'FLOAT', 'DOUBLE', 'PRECISION', 'DATE',
    'TIMESTAMP', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'COALESCE',
    'NULLIF', 'CAST', 'ALTER', 'ADD', 'COLUMN', 'TRUNCATE',
  ],
  ruby: [
    'BEGIN', 'END', 'alias', 'and', 'begin', 'break', 'case',
    'class', 'def', 'defined?', 'do', 'else', 'elsif', 'end',
    'ensure', 'false', 'for', 'if', 'in', 'module', 'next',
    'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return',
    'self', 'super', 'then', 'true', 'undef', 'unless', 'until',
    'when', 'while', 'yield', '__FILE__', '__LINE__',
    'attr_accessor', 'attr_reader', 'attr_writer', 'include',
    'extend', 'prepend', 'raise', 'throw', 'catch',
  ],
  php: [
    'abstract', 'and', 'array', 'as', 'break', 'callable', 'case',
    'catch', 'class', 'clone', 'const', 'continue', 'declare',
    'default', 'die', 'do', 'echo', 'else', 'elseif', 'empty',
    'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch',
    'endwhile', 'eval', 'exit', 'extends', 'final', 'finally',
    'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if',
    'implements', 'include', 'include_once', 'instanceof',
    'insteadof', 'interface', 'isset', 'list', 'match', 'namespace',
    'new', 'or', 'print', 'private', 'protected', 'public',
    'readonly', 'require', 'require_once', 'return', 'static',
    'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var',
    'while', 'xor', 'yield',
  ],
  swift: [
    'associatedtype', 'class', 'deinit', 'enum', 'extension',
    'fileprivate', 'func', 'import', 'init', 'inout', 'internal',
    'let', 'open', 'operator', 'private', 'protocol', 'public',
    'rethrows', 'static', 'struct', 'subscript', 'typealias',
    'var', 'break', 'case', 'catch', 'continue', 'default', 'defer',
    'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in',
    'repeat', 'return', 'switch', 'where', 'while', 'throws',
    'throw', 'try', 'true', 'false', 'nil', 'self', 'Self',
    'super', 'async', 'await', 'actor', 'nonisolated', 'isolated',
  ],
  kotlin: [
    'abstract', 'actual', 'annotation', 'as', 'break', 'by',
    'catch', 'class', 'companion', 'const', 'continue', 'crossinline',
    'data', 'delegate', 'do', 'dynamic', 'else', 'enum', 'expect',
    'external', 'false', 'field', 'file', 'final', 'finally', 'for',
    'fun', 'get', 'if', 'import', 'in', 'infix', 'init', 'inline',
    'inner', 'interface', 'internal', 'is', 'it', 'lateinit',
    'noinline', 'null', 'object', 'open', 'operator', 'out',
    'override', 'package', 'param', 'private', 'property',
    'protected', 'public', 'receiver', 'reified', 'return', 'sealed',
    'set', 'super', 'suspend', 'tailrec', 'this', 'throw', 'true',
    'try', 'typealias', 'typeof', 'val', 'var', 'vararg', 'when',
    'where', 'while',
  ],
  html: [
    '!DOCTYPE', 'html', 'head', 'body', 'div', 'span', 'a', 'href',
    'src', 'class', 'id', 'style', 'script', 'link', 'meta', 'title',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol',
    'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
    'form', 'input', 'button', 'select', 'option', 'textarea',
    'label', 'fieldset', 'legend', 'nav', 'header', 'footer',
    'section', 'article', 'aside', 'main', 'figure', 'figcaption',
    'img', 'video', 'audio', 'source', 'canvas', 'iframe',
    'pre', 'code', 'em', 'strong', 'blockquote', 'cite', 'q',
    'abbr', 'address', 'del', 'ins', 'mark', 's', 'small',
    'sub', 'sup', 'u',
  ],
  css: [
    'color', 'background', 'background-color', 'background-image',
    'margin', 'padding', 'border', 'border-radius', 'box-shadow',
    'font', 'font-size', 'font-weight', 'font-family', 'text-align',
    'display', 'position', 'top', 'left', 'right', 'bottom',
    'width', 'height', 'min-width', 'max-width', 'min-height',
    'max-height', 'overflow', 'z-index', 'opacity', 'visibility',
    'flex', 'flex-direction', 'flex-wrap', 'justify-content',
    'align-items', 'gap', 'grid', 'grid-template', 'gap',
    'transform', 'transition', 'animation', 'cursor',
    'important', 'none', 'auto', 'inherit', 'initial',
    'solid', 'dashed', 'dotted', 'absolute', 'relative',
    'fixed', 'sticky', 'block', 'inline', 'inline-block',
    'flex', 'grid', 'hidden', 'visible', 'center',
    'space-between', 'space-around', 'space-evenly',
    'column', 'row', 'wrap', 'nowrap', 'cover', 'contain',
    'uppercase', 'lowercase', 'capitalize', 'bold', 'italic',
    'underline', 'line-through', 'serif', 'sans-serif',
    'monospace', 'cursive', 'fantasy',
  ],
}

const BUILTINS: Record<string, string[]> = {
  python: [
    'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict',
    'set', 'tuple', 'bool', 'open', 'input', 'map', 'filter', 'zip',
    'enumerate', 'sorted', 'reversed', 'min', 'max', 'sum', 'any',
    'all', 'abs', 'round', 'isinstance', 'hasattr', 'getattr',
    'setattr', 'super', 'Exception', 'ValueError', 'TypeError',
    'KeyError', 'IndexError', 'AttributeError', 'RuntimeError',
    'NotImplementedError', 'StopIteration', 'GeneratorExit',
    'SystemExit', 'KeyboardInterrupt', 'iter', 'next', 'property',
    'staticmethod', 'classmethod', 'format', 'bytearray', 'bytes',
    'memoryview', 'frozenset', 'reversed', 'self', 'cls', '__init__',
    '__str__', '__repr__', '__call__', '__name__', '__main__',
    '__file__', '__dict__', '__class__', '__getitem__', '__setitem__',
    '__len__', '__iter__', '__next__', '__enter__', '__exit__',
    '__add__', '__sub__', '__mul__', '__truediv__',
  ],
  javascript: [
    'console', 'require', 'module', 'exports', '__dirname',
    '__filename', 'process', 'Buffer', 'setTimeout', 'setInterval',
    'clearTimeout', 'clearInterval', 'Promise', 'Array', 'Object',
    'String', 'Number', 'Boolean', 'Map', 'Set', 'WeakMap',
    'WeakSet', 'Symbol', 'Error', 'Date', 'RegExp', 'Math', 'JSON',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI',
    'encodeURI', 'fetch', 'document', 'window', 'global',
    'globalThis', 'console.log', 'console.error', 'console.warn',
    'console.info', 'console.debug', 'console.trace',
    'console.table', 'console.time', 'console.timeEnd',
    'console.group', 'console.groupEnd', 'console.count',
  ],
  typescript: [
    'console', 'require', 'module', 'exports', '__dirname',
    '__filename', 'process', 'Buffer', 'setTimeout', 'setInterval',
    'clearTimeout', 'clearInterval', 'Promise', 'Array', 'Object',
    'String', 'Number', 'Boolean', 'Map', 'Set', 'WeakMap',
    'WeakSet', 'Symbol', 'Error', 'Date', 'RegExp', 'Math', 'JSON',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI',
    'encodeURI', 'fetch', 'document', 'window', 'global',
    'globalThis', 'console.log', 'console.error', 'console.warn',
    'console.info', 'console.debug', 'console.trace',
    'console.table', 'console.time', 'console.timeEnd',
    'console.group', 'console.groupEnd', 'console.count',
    'string', 'number', 'boolean', 'any', 'void', 'never', 'unknown',
    'object', 'bigint', 'symbol', 'undefined', 'null', 'Record',
    'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude',
    'Extract', 'NonNullable', 'ReturnType', 'InstanceType',
    'Parameters', 'ConstructorParameters', 'PromiseLike',
    'ArrayLike', 'Iterable', 'Iterator', 'AsyncIterable',
    'MapLike', 'SetLike',
  ],
  go: [
    'fmt', 'Print', 'Printf', 'Println', 'Sprintf', 'Fprintf',
    'Errorf', 'len', 'cap', 'make', 'new', 'append', 'copy',
    'close', 'delete', 'panic', 'recover', 'complex', 'real',
    'imag', 'string', 'int', 'int8', 'int16', 'int32', 'int64',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'float32',
    'float64', 'bool', 'byte', 'rune', 'error', 'string',
    'nil', 'true', 'false', 'iota', 'string', 'error',
    'http', 'json', 'io', 'os', 'ioutil', 'strconv', 'strings',
    'bytes', 'time', 'context', 'sync', 'atomic',
  ],
  rust: [
    'println!', 'print!', 'format!', 'eprintln!', 'eprint!',
    'write!', 'writeln!', 'assert!', 'assert_eq!', 'assert_ne!',
    'debug_assert!', 'vec!', 'String', 'Vec', 'HashMap', 'Option',
    'Result', 'Box', 'Rc', 'Arc', 'Cell', 'RefCell', 'Mutex',
    'RwLock', 'Some', 'None', 'Ok', 'Err', 'unwrap', 'expect',
    'clone', 'copy', 'iter', 'into_iter', 'map', 'filter',
    'fold', 'collect', 'take', 'as_ref', 'as_mut', 'borrow',
    'borrow_mut', 'self', 'Self', 'panic!', 'todo!', 'unreachable!',
    'dbg!', 'include_str!', 'include_bytes!', 'stringify!',
    'concat!', 'env!', 'option_env!', 'file!', 'line!', 'column!',
  ],
  java: [
    'System', 'out', 'in', 'err', 'println', 'print',
    'String', 'Integer', 'Double', 'Float', 'Boolean', 'Long',
    'Short', 'Byte', 'Character', 'Void', 'Object', 'Class',
    'Thread', 'Runnable', 'Exception', 'RuntimeException',
    'Error', 'Throwable', 'ArrayList', 'LinkedList', 'HashMap',
    'HashSet', 'TreeMap', 'TreeSet', 'Arrays', 'Collections',
    'Math', 'Random', 'File', 'Path', 'Files', 'Stream',
    'Optional', 'Comparator', 'Comparable', 'Serializable',
    'Cloneable', 'Iterable', 'Collection', 'List', 'Set', 'Map',
    'Queue', 'Deque', 'Iterator', 'ListIterator',
  ],
  c_cpp: [
    'printf', 'scanf', 'printf', 'fprintf', 'sprintf', 'snprintf',
    'puts', 'gets', 'fgets', 'fputs', 'fopen', 'fclose', 'fread',
    'fwrite', 'fseek', 'ftell', 'rewind', 'fscanf', 'fprintf',
    'malloc', 'calloc', 'realloc', 'free', 'memcpy', 'memmove',
    'memset', 'memcmp', 'strlen', 'strcpy', 'strncpy', 'strcat',
    'strncat', 'strcmp', 'strncmp', 'strchr', 'strrchr',
    'strstr', 'strtok', 'atoi', 'atol', 'atof', 'strtol',
    'strtoul', 'strtod', 'rand', 'srand', 'time', 'clock',
    'exit', 'abort', 'assert', 'abs', 'labs', 'div', 'ldiv',
    'cout', 'cin', 'cerr', 'clog', 'endl', 'string', 'vector',
    'map', 'set', 'unordered_map', 'unordered_set', 'stack',
    'queue', 'deque', 'priority_queue', 'pair', 'tuple',
    'shared_ptr', 'unique_ptr', 'weak_ptr', 'make_shared',
    'make_unique', 'static_pointer_cast', 'dynamic_pointer_cast',
    'auto_ptr', 'iterator', 'begin', 'end', 'next', 'prev',
    'distance', 'advance', 'back_inserter', 'front_inserter',
    'bind', 'function', 'ref', 'cref', 'move', 'forward',
  ],
  bash: [
    'echo', 'printf', 'read', 'exit', 'return', 'source', '.',
    'export', 'local', 'unset', 'set', 'declare', 'typeset',
    'trap', 'exec', 'eval', 'let', 'test', '[', '[[', ']]',
    'cd', 'pwd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat',
    'grep', 'sed', 'awk', 'find', 'xargs', 'sort', 'uniq',
    'wc', 'cut', 'tr', 'head', 'tail', 'tee', 'diff', 'patch',
    'chmod', 'chown', 'chgrp', 'ps', 'kill', 'jobs', 'fg',
    'bg', 'wait', 'sleep', 'date', 'which', 'whoami', 'id',
    'env', 'printenv', 'basename', 'dirname', 'realpath',
    'readlink', 'mktemp', 'tar', 'gzip', 'gunzip', 'unzip',
    'curl', 'wget', 'ssh', 'scp', 'rsync',
  ],
  ruby: [
    'puts', 'print', 'p', 'require', 'include', 'extend',
    'attr_accessor', 'attr_reader', 'attr_writer', 'raise',
    'throw', 'catch', 'loop', 'block_given?', 'yield',
    'lambda', 'proc', 'Array', 'Hash', 'String', 'Integer',
    'Float', 'Symbol', 'Range', 'Time', 'Date', 'Regexp',
    'nil', 'true', 'false', 'self', '__FILE__', '__LINE__',
    'ENV', 'ARGV', 'STDIN', 'STDOUT', 'STDERR', '$stdin',
    '$stdout', '$stderr', '$LOAD_PATH', '$LOADED_FEATURES',
    'nil?', 'empty?', 'present?', 'blank?', 'any?', 'all?',
    'each', 'map', 'select', 'reject', 'reduce', 'inject',
    'find', 'detect', 'count', 'size', 'length', 'sort',
    'uniq', 'flatten', 'compact', 'merge', 'keys', 'values',
    'include?', 'key?', 'has_key?', 'has_value?', 'fetch',
  ],
  php: [
    'echo', 'print', 'die', 'exit', 'return', 'include',
    'include_once', 'require', 'require_once', '__construct',
    '__destruct', '__call', '__callStatic', '__get', '__set',
    '__isset', '__unset', '__sleep', '__wakeup', '__toString',
    '__invoke', '__set_state', '__clone', '__debugInfo',
    'array', 'count', 'strlen', 'strpos', 'substr', 'trim',
    'explode', 'implode', 'json_encode', 'json_decode',
    'file_get_contents', 'file_put_contents', 'fopen',
    'fclose', 'fwrite', 'fread', 'fgets', 'fgetcsv',
    'preg_match', 'preg_replace', 'preg_split',
    'htmlspecialchars', 'htmlentities', 'strip_tags',
    'header', 'session_start', 'session_destroy',
    'isset', 'empty', 'unset', 'is_array', 'is_string',
    'is_int', 'is_float', 'is_null', 'is_bool',
    'var_dump', 'print_r', 'debug_backtrace',
    'Exception', 'Error', 'InvalidArgumentException',
    'RuntimeException', 'PDO', 'mysqli',
  ],
  swift: [
    'print', 'debugPrint', 'dump', 'fatalError', 'precondition',
    'preconditionFailure', 'assert', 'assertionFailure',
    'String', 'Int', 'Double', 'Float', 'Bool', 'Array',
    'Dictionary', 'Set', 'Optional', 'Character', 'Substring',
    'Data', 'Date', 'URL', 'Error', 'Result', 'Codable',
    'Encodable', 'Decodable', 'Hashable', 'Equatable',
    'Comparable', 'Identifiable', 'CustomStringConvertible',
    'CustomDebugStringConvertible', 'IteratorProtocol',
    'Sequence', 'Collection', 'BidirectionalCollection',
    'RandomAccessCollection', 'MutableCollection',
    'RangeReplaceableCollection', 'LazySequenceProtocol',
    'LazyCollectionProtocol', 'Any', 'AnyObject',
    'nil', 'true', 'false', 'self', 'Self', 'super',
    'map', 'filter', 'reduce', 'compactMap', 'flatMap',
    'forEach', 'sorted', 'split', 'prefix', 'suffix',
    'first', 'last', 'min', 'max', 'contains', 'count',
    'isEmpty', 'append', 'insert', 'remove', 'removeAll',
  ],
  kotlin: [
    'println', 'print', 'readLine', 'require', 'check', 'error',
    'TODO', 'run', 'let', 'apply', 'also', 'with', 'use',
    'repeat', 'lazy', 'lateinit', 'by', 'arrayOf', 'listOf',
    'mapOf', 'setOf', 'mutableListOf', 'mutableMapOf',
    'mutableSetOf', 'emptyList', 'emptyMap', 'emptySet',
    'String', 'Int', 'Double', 'Float', 'Long', 'Short',
    'Byte', 'Boolean', 'Char', 'Unit', 'Nothing', 'Any',
    'Any?', 'Nothing?', 'List', 'MutableList', 'Map',
    'MutableMap', 'Set', 'MutableSet', 'Pair', 'Triple',
    'Array', 'IntArray', 'DoubleArray', 'BooleanArray',
    'Comparable', 'Iterable', 'Iterator', 'Sequence',
    'Collection', 'null', 'true', 'false', 'this', 'super',
    'data class', 'sealed class', 'enum class', 'open class',
    'abstract class', 'inner class', 'companion object',
    'object', 'init', 'constructor',
    'map', 'filter', 'reduce', 'fold', 'forEach', 'sortedBy',
    'groupBy', 'associate', 'partition', 'flatMap', 'flatten',
    'first', 'last', 'firstOrNull', 'lastOrNull', 'find',
    'findLast', 'single', 'singleOrNull', 'elementAt',
    'elementAtOrNull', 'count', 'size', 'isEmpty', 'isNotEmpty',
    'contains', 'containsAll', 'toList', 'toSet', 'toMap',
  ],
}

function compileSyntax(raw: Record<string, string[]>): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {}
  for (const [lang, words] of Object.entries(raw)) {
    result[lang] = new Set(words)
  }
  return result as Record<string, Set<string>>
}

const KEYWORD_SETS: Record<string, Set<string>> = compileSyntax(KEYWORDS)
const BUILTIN_SETS: Record<string, Set<string>> = compileSyntax(BUILTINS)

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  py3: 'python',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  c: 'c_cpp',
  cpp: 'c_cpp',
  'c++': 'c_cpp',
  h: 'c_cpp',
  hpp: 'c_cpp',
  cxx: 'c_cpp',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  svg: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  sass: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  shell: 'bash',
  fish: 'bash',
  sql: 'sql',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kotlin: 'kotlin',
  md: 'markdown',
  markdown: 'markdown',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  toml: 'toml',
  pl: 'perl',
  perl: 'perl',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  scala: 'scala',
  elixir: 'elixir',
  ex: 'elixir',
  hs: 'haskell',
  haskell: 'haskell',
  clj: 'clojure',
  clojure: 'clojure',
}

const LINE_COMMENT_CHARS: Record<string, string[]> = {
  python: ['#'],
  javascript: ['//'],
  typescript: ['//'],
  c_cpp: ['//'],
  go: ['//'],
  rust: ['//'],
  java: ['//'],
  bash: ['#'],
  ruby: ['#'],
  php: ['//', '#'],
  swift: ['//'],
  kotlin: ['//'],
  sql: ['--'],
  yaml: ['#'],
  toml: ['#'],
  perl: ['#'],
  lua: ['--'],
  r: ['#'],
  dart: ['//'],
  scala: ['//'],
  elixir: ['#'],
  haskell: ['--'],
  clojure: [';'],
}

function langSyntax(lang: string): {
  keywords: Set<string>
  builtins: Set<string>
  commentPrefixes: string[]
  stringDelimiters: string[]
} {
  const base = LANG_ALIASES[lang] ?? lang
  const keywords = KEYWORD_SETS[base] ?? new Set()
  const builtins = BUILTIN_SETS[base] ?? new Set()

  let commentPrefixes: string[] = []
  if (base === 'javascript' || base === 'typescript') {
    commentPrefixes = ['//']
  } else if (base === 'c_cpp' || base === 'go' || base === 'rust' || base === 'java' || base === 'swift' || base === 'kotlin' || base === 'dart' || base === 'scala') {
    commentPrefixes = ['//']
  } else if (base === 'python' || base === 'bash' || base === 'yaml' || base === 'toml' || base === 'ruby' || base === 'perl' || base === 'r' || base === 'elixir') {
    commentPrefixes = ['#']
  } else if (base === 'php') {
    commentPrefixes = ['//', '#']
  } else if (base === 'sql' || base === 'lua' || base === 'haskell') {
    commentPrefixes = ['--']
  } else if (base === 'clojure') {
    commentPrefixes = [';']
  } else {
    commentPrefixes = LINE_COMMENT_CHARS[base] ?? ['//']
  }

  let stringDelimiters: string[]
  if (base === 'python' || base === 'javascript' || base === 'typescript' || base === 'ruby') {
    stringDelimiters = ["'", '"', '`']
  } else if (base === 'go') {
    stringDelimiters = ['"', '`']
  } else if (base === 'rust') {
    stringDelimiters = ['"']
  } else if (base === 'bash') {
    stringDelimiters = ["'", '"']
  } else {
    stringDelimiters = ["'", '"']
  }

  return { keywords, builtins, commentPrefixes, stringDelimiters }
}

function hasBlockComments(lang: string): boolean {
  const base = LANG_ALIASES[lang] ?? lang
  const blockCommentLangs = new Set([
    'javascript', 'typescript', 'c_cpp', 'go', 'rust', 'java',
    'swift', 'kotlin', 'css', 'php', 'scala', 'dart',
  ])
  return blockCommentLangs.has(base)
}

export interface HighlightState {
  inBlockComment: boolean
}

const BLOCK_COMMENT_START = '/*'
const BLOCK_COMMENT_END = '*/'

export function highlightCodeLine(line: string, lang: string, state: HighlightState): string {
  const { keywords, builtins, commentPrefixes, stringDelimiters } = langSyntax(lang)
  const result: string[] = []
  let i = 0
  const len = line.length

  while (i < len) {
    if (state.inBlockComment) {
      const endIdx = line.indexOf(BLOCK_COMMENT_END, i)
      if (endIdx === -1) {
        result.push(pc.dim(line.slice(i)))
        i = len
        break
      }
      result.push(pc.dim(line.slice(i, endIdx + 2)))
      i = endIdx + 2
      state.inBlockComment = false
      continue
    }

    if (hasBlockComments(lang) && line.slice(i, i + 2) === BLOCK_COMMENT_START) {
      const endIdx = line.indexOf(BLOCK_COMMENT_END, i + 2)
      if (endIdx === -1) {
        result.push(pc.dim(line.slice(i)))
        state.inBlockComment = true
        i = len
        break
      }
      result.push(pc.dim(line.slice(i, endIdx + 2)))
      i = endIdx + 2
      continue
    }

    let matchedComment = false
    for (const prefix of commentPrefixes) {
      if (line.slice(i, i + prefix.length) === prefix) {
        result.push(pc.dim(line.slice(i)))
        i = len
        matchedComment = true
        break
      }
    }
    if (matchedComment) break

    let matchedString = false
    for (const delim of stringDelimiters) {
      if (line[i] === delim) {
        let j = i + 1
        while (j < len) {
          if (line[j] === '\\') {
            j += 2
          } else if (line[j] === delim) {
            j++
            break
          } else {
            j++
          }
        }
        result.push(pc.green(line.slice(i, j)))
        i = j
        matchedString = true
        break
      }
    }
    if (matchedString) continue

    if (/\d/.test(line[i]) && (i === 0 || !/[a-zA-Z_]/.test(line[i - 1]))) {
      let j = i + 1
      while (j < len && /[\d.]/.test(line[j])) j++
      result.push(pc.magenta(line.slice(i, j)))
      i = j
      continue
    }

    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i + 1
      while (j < len && /\w/.test(line[j])) j++
      const word = line.slice(i, j)

      if (keywords.has(word)) {
        result.push(pc.yellow(word))
      } else if (builtins.has(word)) {
        result.push(pc.cyan(word))
      } else {
        result.push(word)
      }

      i = j
      continue
    }

    result.push(line[i])
    i++
  }

  return result.join('')
}

function wrapAnsi(s: string, width: number): string[] {
  if (!s) return ['']
  const lines: string[] = []
  let currentLine = ''
  let currentWidth = 0
  let activeStyles = ''
  
  let i = 0
  const len = s.length
  
  while (i < len) {
    if (s.charCodeAt(i) === 0x1b) {
      const end = s.indexOf('m', i)
      if (end !== -1) {
        const ansiSeq = s.slice(i, end + 1)
        currentLine += ansiSeq
        activeStyles += ansiSeq
        if (ansiSeq === '\x1b[0m') {
          activeStyles = ''
        }
        i = end + 1
        continue
      }
    }
    
    const char = s[i]
    const charWidth = vw(char)
    
    if (currentWidth + charWidth > width) {
      lines.push(currentLine + '\x1b[0m')
      currentLine = activeStyles + char
      currentWidth = charWidth
    } else {
      currentLine += char
      currentWidth += charWidth
    }
    i++
  }
  
  if (currentLine) {
    lines.push(currentLine)
  }
  
  return lines
}

export function renderMarkdown(text: string, maxWidth?: number): string[] {
  const width = maxWidth ?? (process.stdout.columns ?? 100) - 4
  const lines = text.split('\n')
  const result: string[] = []
  let inCodeBlock = false
  let codeBlockLang = ''
  let inBlockComment = false

  for (const raw of lines) {
    if (raw.startsWith('```')) {
      if (inCodeBlock) {
        result.push(pc.gray('└' + '─'.repeat(width - 1)))
      } else {
        const info = raw.slice(3).trim().split(/\s/)[0]
        codeBlockLang = LANG_ALIASES[info] ?? info
        const prefix = '┌──'
        const suffix = codeBlockLang ? ` ${codeBlockLang} ` : ''
        const remaining = Math.max(0, width - prefix.length - suffix.length)
        result.push(pc.gray(prefix + suffix + '─'.repeat(remaining)))
      }
      inCodeBlock = !inCodeBlock
      inBlockComment = false
      continue
    }

    if (inCodeBlock) {
      let highlighted = ''
      if (codeBlockLang) {
        const state: HighlightState = { inBlockComment }
        highlighted = highlightCodeLine(raw, codeBlockLang, state)
        inBlockComment = state.inBlockComment
      } else {
        highlighted = raw
      }

      // Code blocks are indented by 2 spaces, so the inner width is width - 2
      const wrapped = wrapAnsi(highlighted, width - 2)
      for (const line of wrapped) {
        result.push('  ' + line)
      }
      continue
    }

    if (raw.startsWith('### ')) {
      const wrapped = wrap(raw.slice(4), width)
      for (const line of wrapped) {
        result.push(pc.bold(pc.cyan(line)))
      }
      continue
    }
    if (raw.startsWith('## ')) {
      const wrapped = wrap(raw.slice(3), width)
      for (const line of wrapped) {
        result.push(pc.bold(pc.cyan(line)))
      }
      continue
    }
    if (raw.startsWith('# ')) {
      const wrapped = wrap(raw.slice(2), width)
      for (const line of wrapped) {
        result.push(pc.bold(pc.cyan(line)))
      }
      continue
    }

    if (raw.startsWith('> ')) {
      const wrapped = wrap(raw.slice(2), width - 2)
      if (wrapped.length === 0) {
        result.push(pc.dim('│ '))
      } else {
        for (const line of wrapped) {
          result.push(pc.dim('│ ') + renderInline(line))
        }
      }
      continue
    }

    if (raw.match(/^\d+\.\s/)) {
      const match = raw.match(/^(\d+\.\s)(.*)/)
      if (match) {
        const prefix = match[1]
        const content = match[2]
        const wrapped = wrap(content, width - prefix.length)
        if (wrapped.length === 0) {
          result.push(prefix)
        } else {
          wrapped.forEach((line, idx) => {
            if (idx === 0) {
              result.push(prefix + renderInline(line))
            } else {
              result.push(' '.repeat(prefix.length) + renderInline(line))
            }
          })
        }
      }
      continue
    }

    if (/^[-*]\s/.test(raw)) {
      const content = raw.slice(2)
      const prefix = ' ' + pc.dim('•') + ' '
      const wrapped = wrap(content, width - 4)
      if (wrapped.length === 0) {
        result.push(prefix)
      } else {
        wrapped.forEach((line, idx) => {
          if (idx === 0) {
            result.push(prefix + renderInline(line))
          } else {
            result.push('    ' + renderInline(line))
          }
        })
      }
      continue
    }

    if (raw.match(/^[-_]{3,}$/)) {
      result.push(pc.dim('─'.repeat(width)))
      continue
    }

    const wrapped = wrap(raw, width)
    if (wrapped.length === 0) {
      result.push('')
    } else {
      for (const line of wrapped) {
        result.push(renderInline(line))
      }
    }
  }

  return result
}


function renderInline(text: string): string {
  let r: string = text

  r = r.replace(/\*\*(.+?)\*\*/g, (_, m: string) => pc.bold(m))
  r = r.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, (_, m: string) => pc.italic(m))
  r = r.replace(/`([^`]+)`/g, (_, m: string) => pc.bgCyan(pc.black(m)))
  r = r.replace(/~~(.+?)~~/g, (_, m: string) => pc.dim(pc.strikethrough(m)))

  return r
}
