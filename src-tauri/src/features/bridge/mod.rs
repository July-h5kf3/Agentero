//! Remote Bridge protocol primitives shared by the desktop Host and iOS client.
//!
//! The Relay only routes opaque WebSocket frames. This module owns the durable
//! Host identity, pairing registry, and QR offer wire format; transport and RPC
//! execution are layered on top in sibling modules.

mod crypto;
mod identity;
mod messages;
mod protocol;
mod relay;

pub use crypto::SessionCipher;
pub use identity::{BridgeDevice, BridgeDeviceStore, BridgeIdentity, BridgeIdentityStore};
pub use messages::{BridgeMessage, E2eeHandshake, RelayControlMessage, RpcError};
pub use protocol::{
    BridgeOffer, RelayEndpoint, RelayOffer, DEFAULT_RELAY_ENDPOINT, RELAY_PROTOCOL_VERSION,
};
pub use relay::{connect_relay, next_frame, send_binary, send_text, RelayFrame, RelaySocket};
