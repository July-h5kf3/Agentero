export type SettingsSection =
	| "general"
	| "appearance"
	| "agent"
	| "translate"
	| "keyboard"
	| "privacy"
	| "about";

/** Which machine the Agent catalog / probe targets. */
export type SettingsHostContext =
	| { kind: "local"; label: string }
	| {
			kind: "remote";
			label: string;
			sessionId: string;
			host: string;
			remotePath: string;
	  };
