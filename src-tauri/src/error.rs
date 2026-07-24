use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),

    #[error("agent not found: {0}")]
    AgentNotFound(String),

    #[error("agent unavailable: {0}")]
    AgentUnavailable(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("acp: {0}")]
    Acp(String),

    #[error("sqlite: {0}")]
    Sqlite(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value.to_string())
    }
}

impl AppError {
    pub fn message(msg: impl Into<String>) -> Self {
        Self::Message(msg.into())
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Message(_) => "message",
            Self::AgentNotFound(_) => "agent_not_found",
            Self::AgentUnavailable(_) => "agent_unavailable",
            Self::Io(_) => "io",
            Self::Json(_) => "json",
            Self::Acp(_) => "acp",
            Self::Sqlite(_) => "sqlite",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResult<T: Serialize> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

impl<T: Serialize> ApiResult<T> {
    pub fn ok(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(err: AppError) -> ApiResult<T> {
        ApiResult {
            ok: false,
            data: None,
            error: Some(ErrorBody {
                code: err.code().to_string(),
                message: err.to_string(),
                details: None,
            }),
        }
    }

    pub fn err_with_details(err: AppError, details: serde_json::Value) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(ErrorBody {
                code: err.code().to_string(),
                message: err.to_string(),
                details: Some(details),
            }),
        }
    }
}

pub fn map_err<T: Serialize>(err: AppError) -> ApiResult<T> {
    ApiResult::err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_structured_recovery_details_in_api_errors() {
        let result: ApiResult<()> = ApiResult::err_with_details(
            AppError::message("external repair failed"),
            serde_json::json!({
                "code": "writeFailed",
                "rollback": "manual-recovery-required",
            }),
        );

        let value = serde_json::to_value(result).expect("error response serializes");
        assert_eq!(value["error"]["details"]["code"], "writeFailed");
        assert_eq!(
            value["error"]["details"]["rollback"],
            "manual-recovery-required"
        );
    }
}
