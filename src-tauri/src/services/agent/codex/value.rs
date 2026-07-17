use serde_json::Value;

/// First value at any of `keys` that is a JSON string.
pub(super) fn string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_string))
}

/// First value at any of `keys` that is a string or number, rendered as a string.
pub(super) fn scalar_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| match value.get(*key) {
        Some(Value::String(value)) => Some(value.clone()),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    })
}

/// Flatten a Codex content payload (string / array / `{text|content|message}`) to text.
pub(super) fn content_text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(content_text)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                return text.to_string();
            }
            if let Some(content) = map.get("content") {
                return content_text(content);
            }
            if let Some(message) = map.get("message") {
                return content_text(message);
            }
            String::new()
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{content_text, scalar_string, string};
    use serde_json::json;

    #[test]
    fn string_returns_first_matching_string_key() {
        let value = json!({ "a": 3, "b": "second" });
        // "a" is a number → skipped; "b" is the first string match.
        assert_eq!(string(&value, &["a", "b"]), Some("second".to_string()));
        assert_eq!(string(&value, &["missing"]), None);
    }

    #[test]
    fn scalar_string_accepts_strings_and_numbers_only() {
        let value = json!({ "s": "hi", "n": 42, "b": true });
        assert_eq!(scalar_string(&value, &["s"]), Some("hi".to_string()));
        assert_eq!(scalar_string(&value, &["n"]), Some("42".to_string()));
        assert_eq!(scalar_string(&value, &["b"]), None);
        assert_eq!(
            scalar_string(&value, &["missing", "n"]),
            Some("42".to_string())
        );
    }

    #[test]
    fn content_text_flattens_strings_arrays_and_objects() {
        assert_eq!(content_text(&json!("plain")), "plain");
        assert_eq!(content_text(&json!({ "text": "t" })), "t");
        assert_eq!(content_text(&json!({ "content": { "text": "c" } })), "c");
        assert_eq!(content_text(&json!({ "message": { "text": "m" } })), "m");
        assert_eq!(content_text(&json!(["a", "", { "text": "b" }])), "a\nb");
        assert_eq!(content_text(&json!(42)), "");
    }
}
