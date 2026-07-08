export default {
	"*.{ts,tsx,js,jsx,json,jsonc,css,html,md}": () => "pnpm run fix:ts",
	"src-tauri/**/*.rs": () => "pnpm run fix:rs",
};
