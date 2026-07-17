import { beforeEach, describe, expect, it } from "vitest";
import { LIBRARY_VIRTUAL_PATH } from "@/lib/papers-api";
import {
	createPlaceholderTab,
	cycleActiveTabId,
	type DocTab,
	insertPlaceholderTab,
	loadPersistedTabs,
	moveTab,
	patchTab,
	removeTab,
	removeTabsUnderPath,
	reseedMarkdownTab,
	reseedNotesTab,
	savePersistedTabs,
	syncTabSeedsForPath,
} from "@/lib/tabs";

function makeTab(path: string, overrides: Partial<DocTab> = {}): DocTab {
	return { ...createPlaceholderTab(path), ...overrides };
}

describe("createPlaceholderTab", () => {
	it("builds an unloaded placeholder from a normalized id", () => {
		const tab = createPlaceholderTab("/vault/a.md", "pdf");
		expect(tab.id).toBe("/vault/a.md");
		expect(tab.kind).toBe("file");
		expect(tab.title).toBe("a.md");
		expect(tab.mode).toBe("pdf");
		expect(tab.loaded).toBe(false);
	});

	it("special-cases the Library virtual path", () => {
		const tab = createPlaceholderTab(LIBRARY_VIRTUAL_PATH);
		expect(tab.path).toBe(LIBRARY_VIRTUAL_PATH);
		expect(tab.kind).toBe("library");
		expect(tab.title).toBe("Library");
		expect(tab.mode).toBe("markdown");
	});
});

describe("insertPlaceholderTab", () => {
	it("appends a new tab", () => {
		const { tabs, id, exists } = insertPlaceholderTab([], "/vault/a.md");
		expect(exists).toBe(false);
		expect(id).toBe("/vault/a.md");
		expect(tabs).toHaveLength(1);
	});

	it("dedupes by id and returns the original array", () => {
		const start = [makeTab("/vault/a.md")];
		const { tabs, exists } = insertPlaceholderTab(start, "/Vault/A.md");
		expect(exists).toBe(true);
		expect(tabs).toBe(start);
	});
});

describe("patchTab", () => {
	it("merges the patch into the matching tab only", () => {
		const start = [makeTab("/vault/a.md"), makeTab("/vault/b.md")];
		const next = patchTab(start, "/vault/a.md", { loaded: true, title: "A" });
		expect(next[0]?.loaded).toBe(true);
		expect(next[0]?.title).toBe("A");
		expect(next[1]?.loaded).toBe(false);
	});
});

describe("removeTab", () => {
	const start = [
		makeTab("/vault/a.md"),
		makeTab("/vault/b.md"),
		makeTab("/vault/c.md"),
	];

	it("moves the active id to the following neighbor", () => {
		const { tabs, activeId } = removeTab(start, "/vault/b.md", "/vault/b.md");
		expect(tabs.map((t) => t.id)).toEqual(["/vault/a.md", "/vault/c.md"]);
		expect(activeId).toBe("/vault/c.md");
	});

	it("clamps to the last tab when removing the final active tab", () => {
		const { activeId } = removeTab(start, "/vault/c.md", "/vault/c.md");
		expect(activeId).toBe("/vault/b.md");
	});

	it("keeps a different active id untouched", () => {
		const { activeId } = removeTab(start, "/vault/a.md", "/vault/b.md");
		expect(activeId).toBe("/vault/b.md");
	});

	it("returns null active when the last tab is removed", () => {
		const { tabs, activeId } = removeTab(
			[makeTab("/vault/a.md")],
			"/vault/a.md",
			"/vault/a.md",
		);
		expect(tabs).toHaveLength(0);
		expect(activeId).toBeNull();
	});

	it("is a no-op for an unknown id", () => {
		const { tabs, removed, activeId } = removeTab(
			start,
			"/nope",
			"/vault/a.md",
		);
		expect(tabs).toBe(start);
		expect(removed).toBeNull();
		expect(activeId).toBe("/vault/a.md");
	});
});

describe("removeTabsUnderPath", () => {
	it("removes tabs at or under the path but keeps Library", () => {
		const start = [
			makeTab(LIBRARY_VIRTUAL_PATH),
			makeTab("/vault/papers/x"),
			makeTab("/vault/papers/x/NOTES.md"),
			makeTab("/vault/other.md"),
		];
		const { tabs, removed, activeId } = removeTabsUnderPath(
			start,
			"/vault/papers/x",
			"/vault/papers/x",
		);
		expect(tabs.map((t) => t.id)).toEqual([
			LIBRARY_VIRTUAL_PATH,
			"/vault/other.md",
		]);
		expect(removed).toHaveLength(2);
		expect(activeId).toBe("/vault/other.md");
	});

	it("is a no-op when nothing matches", () => {
		const start = [makeTab("/vault/a.md")];
		const { tabs, removed } = removeTabsUnderPath(
			start,
			"/vault/z",
			"/vault/a.md",
		);
		expect(tabs).toBe(start);
		expect(removed).toHaveLength(0);
	});
});

describe("moveTab", () => {
	const start = [
		makeTab("/vault/a.md"),
		makeTab("/vault/b.md"),
		makeTab("/vault/c.md"),
	];

	it("reorders from -> to", () => {
		const next = moveTab(start, "/vault/a.md", "/vault/c.md");
		expect(next.map((t) => t.id)).toEqual([
			"/vault/b.md",
			"/vault/c.md",
			"/vault/a.md",
		]);
	});

	it("is a no-op when ids match or are missing", () => {
		expect(moveTab(start, "/vault/a.md", "/vault/a.md")).toBe(start);
		expect(moveTab(start, "/nope", "/vault/a.md")).toBe(start);
	});
});

describe("cycleActiveTabId", () => {
	const list = [
		makeTab("/vault/a.md"),
		makeTab("/vault/b.md"),
		makeTab("/vault/c.md"),
	];

	it("wraps forward and backward", () => {
		expect(cycleActiveTabId(list, "/vault/a.md", 1)).toBe("/vault/b.md");
		expect(cycleActiveTabId(list, "/vault/a.md", -1)).toBe("/vault/c.md");
		expect(cycleActiveTabId(list, "/vault/c.md", 1)).toBe("/vault/a.md");
	});

	it("does nothing with fewer than two tabs", () => {
		expect(cycleActiveTabId([list[0]], "/vault/a.md", 1)).toBe("/vault/a.md");
	});
});

describe("reseed helpers", () => {
	it("reseedNotesTab bumps notesKey and clears notesDirty", () => {
		const start = [
			makeTab("/vault/papers/x", { notesKey: 2, notesDirty: true }),
		];
		const next = reseedNotesTab(start, "/vault/papers/x", "hello");
		expect(next[0]?.notesSeed).toBe("hello");
		expect(next[0]?.notesKey).toBe(3);
		expect(next[0]?.notesDirty).toBe(false);
	});

	it("reseedMarkdownTab bumps seedKey and clears markdownDirty", () => {
		const start = [makeTab("/vault/a.md", { seedKey: 5, markdownDirty: true })];
		const next = reseedMarkdownTab(start, "/vault/a.md", "world");
		expect(next[0]?.markdownSeed).toBe("world");
		expect(next[0]?.seedKey).toBe(6);
		expect(next[0]?.markdownDirty).toBe(false);
	});
});

describe("syncTabSeedsForPath", () => {
	it("updates notesSeed when the notes path matches", () => {
		const start = [
			makeTab("/vault/papers/x", { notesPath: "/vault/papers/x/NOTES.md" }),
		];
		const next = syncTabSeedsForPath(start, "/vault/papers/x/notes.md", "n");
		expect(next[0]?.notesSeed).toBe("n");
	});

	it("updates markdownSeed when the tab path matches", () => {
		const start = [makeTab("/vault/a.md")];
		const next = syncTabSeedsForPath(start, "/VAULT/A.MD", "m");
		expect(next[0]?.markdownSeed).toBe("m");
	});
});

describe("tab session persistence", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => store.set(k, v),
				removeItem: (k: string) => store.delete(k),
			},
		});
	});

	it("round-trips tabs and the active index", () => {
		const tabs = [
			makeTab("/vault/a.md"),
			makeTab("/vault/b.md", { mode: "pdf" }),
		];
		savePersistedTabs(tabs, "/vault/b.md");
		const loaded = loadPersistedTabs();
		expect(loaded?.tabs).toEqual([
			{ path: "/vault/a.md", mode: "markdown" },
			{ path: "/vault/b.md", mode: "pdf" },
		]);
		expect(loaded?.activeIndex).toBe(1);
	});

	it("clears storage when there are no tabs", () => {
		savePersistedTabs([makeTab("/vault/a.md")], "/vault/a.md");
		savePersistedTabs([], null);
		expect(loadPersistedTabs()).toBeNull();
	});
});
