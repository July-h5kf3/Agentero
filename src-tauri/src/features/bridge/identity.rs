use crate::core::error::AppError;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use crypto_box::aead::OsRng;
use crypto_box::{PublicKey, SecretKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const IDENTITY_FILE: &str = "identity.json";
const DEVICES_FILE: &str = "devices.json";

/// Long-lived desktop identity. The secret key stays in the local config dir
/// and is never added to a QR offer or sent to the Relay.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeIdentity {
    pub v: u8,
    pub server_id: String,
    pub public_key_b64: String,
    pub secret_key_b64: String,
    pub created_at: DateTime<Utc>,
}

impl BridgeIdentity {
    pub fn create() -> Self {
        let secret = SecretKey::generate(&mut OsRng);
        let public = secret.public_key();
        let server_id = format!(
            "agt_{}",
            URL_SAFE_NO_PAD.encode(uuid::Uuid::new_v4().as_bytes())
        );
        Self {
            v: 1,
            server_id,
            public_key_b64: URL_SAFE_NO_PAD.encode(public.as_bytes()),
            secret_key_b64: URL_SAFE_NO_PAD.encode(secret.to_bytes()),
            created_at: Utc::now(),
        }
    }

    pub fn secret_key(&self) -> Result<SecretKey, AppError> {
        let bytes = decode_32(&self.secret_key_b64, "Bridge secret key")?;
        Ok(SecretKey::from(bytes))
    }

    pub fn public_key(&self) -> Result<PublicKey, AppError> {
        let bytes = decode_32(&self.public_key_b64, "Bridge public key")?;
        Ok(PublicKey::from(bytes))
    }
}

/// A client device that was manually approved by the desktop user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeDevice {
    pub device_id: String,
    pub name: String,
    pub public_key_b64: String,
    pub paired_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub revoked: bool,
}

pub struct BridgeIdentityStore {
    dir: PathBuf,
}

impl BridgeIdentityStore {
    pub fn at_default_path() -> Self {
        Self {
            dir: crate::core::paths::bridge_config_dir(),
        }
    }

    #[cfg(test)]
    pub fn at_path(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn load_or_create(&self) -> Result<BridgeIdentity, AppError> {
        let path = self.dir.join(IDENTITY_FILE);
        if path.is_file() {
            return read_json(&path);
        }

        let identity = BridgeIdentity::create();
        write_private_json(&path, &identity)?;
        Ok(identity)
    }

    pub fn reset(&self) -> Result<BridgeIdentity, AppError> {
        let identity = BridgeIdentity::create();
        write_private_json(&self.dir.join(IDENTITY_FILE), &identity)?;
        Ok(identity)
    }
}

pub struct BridgeDeviceStore {
    dir: PathBuf,
}

impl BridgeDeviceStore {
    pub fn at_default_path() -> Self {
        Self {
            dir: crate::core::paths::bridge_config_dir(),
        }
    }

    #[cfg(test)]
    pub fn at_path(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn list(&self) -> Result<Vec<BridgeDevice>, AppError> {
        let path = self.dir.join(DEVICES_FILE);
        if !path.is_file() {
            return Ok(Vec::new());
        }
        read_json(&path)
    }

    pub fn upsert(&self, device: BridgeDevice) -> Result<(), AppError> {
        let mut devices = self.list()?;
        if let Some(existing) = devices
            .iter_mut()
            .find(|candidate| candidate.device_id == device.device_id)
        {
            *existing = device;
        } else {
            devices.push(device);
        }
        write_private_json(&self.dir.join(DEVICES_FILE), &devices)
    }

    pub fn revoke(&self, device_id: &str) -> Result<bool, AppError> {
        let mut devices = self.list()?;
        let Some(device) = devices
            .iter_mut()
            .find(|candidate| candidate.device_id == device_id)
        else {
            return Ok(false);
        };
        device.revoked = true;
        write_private_json(&self.dir.join(DEVICES_FILE), &devices)?;
        Ok(true)
    }
}

fn decode_32(value: &str, label: &str) -> Result<[u8; 32], AppError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::message(format!("{label} is not valid base64url")))?;
    bytes
        .try_into()
        .map_err(|_| AppError::message(format!("{label} must contain 32 bytes")))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, AppError> {
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(AppError::from)
}

fn write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::message("Bridge config path has no parent"))?;
    fs::create_dir_all(parent)?;
    let raw = serde_json::to_vec_pretty(value)?;
    fs::write(path, raw)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("agentero-bridge-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn identity_is_stable_after_its_first_creation() {
        let dir = test_dir();
        let store = BridgeIdentityStore::at_path(dir.clone());
        let first = store.load_or_create().expect("create identity");
        let second = store.load_or_create().expect("load identity");

        assert_eq!(first, second);
        assert!(first.server_id.starts_with("agt_"));
        assert_eq!(
            first.public_key().expect("public key"),
            first.secret_key().expect("secret key").public_key()
        );

        fs::remove_dir_all(dir).expect("clean test directory");
    }

    #[test]
    fn device_registry_can_revoke_a_single_device() {
        let dir = test_dir();
        let store = BridgeDeviceStore::at_path(dir.clone());
        let device = BridgeDevice {
            device_id: "ios_1".to_string(),
            name: "Phil's iPhone".to_string(),
            public_key_b64: URL_SAFE_NO_PAD.encode([7_u8; 32]),
            paired_at: Utc::now(),
            last_seen_at: None,
            revoked: false,
        };
        store.upsert(device).expect("store device");

        assert!(store.revoke("ios_1").expect("revoke device"));
        assert!(store.list().expect("list devices")[0].revoked);

        fs::remove_dir_all(dir).expect("clean test directory");
    }
}
