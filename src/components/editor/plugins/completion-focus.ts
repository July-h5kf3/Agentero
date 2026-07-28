export function editorCompletionHasFocus(
	container: Pick<HTMLElement, "contains"> | null,
	activeElement: Element | null,
): boolean {
	return Boolean(
		container && activeElement && container.contains(activeElement),
	);
}
