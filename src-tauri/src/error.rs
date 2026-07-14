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
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
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
            }),
        }
    }
}

pub fn map_err<T: Serialize>(err: AppError) -> ApiResult<T> {
    ApiResult::err(err)
}
