/**
 * Shared AskUserQuestion UI (AI Elements Suggestion chips).
 * Used by:
 * - ACP tool cards with variant AskUserQuestion
 * - ACP form elicitation (Codex request_user_input) above the composer
 *
 * Multi-question UX is paginated: one question per page, prev/next, Submit on last.
 * Options + optional free-text "Other" stay on the same page.
 */
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AskUserQuestion } from "@/lib/agent/chat-state";
import { cn } from "@/lib/core/utils";

function isAnswerComplete(
	question: AskUserQuestion,
	answer: string | undefined,
): boolean {
	const value = answer?.trim() ?? "";
	if (question.options.length > 0) {
		// Option selected, or free-text Other when allowed.
		if (value) return true;
		return question.required === false;
	}
	// Free-text only page.
	if (question.required === false) return true;
	return Boolean(value);
}

export function AskUserQuestionForm({
	questions,
	disabled = false,
	title,
	className,
	onSubmit,
	onCancel,
}: {
	questions: AskUserQuestion[];
	disabled?: boolean;
	/** Optional heading above the questions (composer card). */
	title?: string;
	className?: string;
	/** Selected labels (or free-text) in question order. Returns true when accepted. */
	onSubmit: (answers: string[]) => Promise<boolean>;
	onCancel?: () => void;
}) {
	const { t } = useTranslation("agent");
	/** Effective answer per question: option label or free-text Other. */
	const [answers, setAnswers] = useState<string[]>([]);
	/** Free-text draft when question has options + allowOther (may mirror answers). */
	const [otherDrafts, setOtherDrafts] = useState<string[]>([]);
	const [page, setPage] = useState(0);
	const [sending, setSending] = useState(false);
	const [submitted, setSubmitted] = useState(false);

	if (!questions.length) return null;

	const total = questions.length;
	const index = Math.min(page, total - 1);
	const question = questions[index];
	if (!question) return null;

	const isFirst = index === 0;
	const isLast = index === total - 1;
	const multi = total > 1;
	const currentAnswer = answers[index] ?? "";
	const otherDraft = otherDrafts[index] ?? "";
	const selectedOption =
		question.options.find((option) => option.label === currentAnswer)?.label ??
		null;
	const showOtherInput =
		Boolean(question.allowOther) || question.options.length === 0;
	const currentReady = isAnswerComplete(question, currentAnswer);
	const allReady = questions.every((q, i) => isAnswerComplete(q, answers[i]));
	const busy = disabled || sending || submitted;

	const setOption = (questionIndex: number, label: string) => {
		setAnswers((current) => {
			const next = [...current];
			next[questionIndex] = label;
			return next;
		});
		setOtherDrafts((current) => {
			const next = [...current];
			next[questionIndex] = "";
			return next;
		});
	};

	const setOtherText = (questionIndex: number, text: string) => {
		setOtherDrafts((current) => {
			const next = [...current];
			next[questionIndex] = text;
			return next;
		});
		setAnswers((current) => {
			const next = [...current];
			// Free-text wins over option when non-empty; clearing free-text keeps prior option if any.
			if (text.trim()) {
				next[questionIndex] = text;
			} else {
				const q = questions[questionIndex];
				const prev = current[questionIndex];
				const stillOption = q?.options.some((o) => o.label === prev);
				next[questionIndex] = stillOption ? (prev ?? "") : "";
			}
			return next;
		});
	};

	const goPrev = () => {
		if (!isFirst && !busy) setPage((p) => Math.max(0, p - 1));
	};

	const goNext = () => {
		if (!isLast && currentReady && !busy) {
			setPage((p) => Math.min(total - 1, p + 1));
		}
	};

	const doSubmit = () => {
		if (!allReady || busy) return;
		setSending(true);
		void onSubmit(answers).then((sent) => {
			setSending(false);
			setSubmitted(sent);
		});
	};

	return (
		<div className={cn("space-y-3", className)}>
			{title ? (
				<p className="text-muted-foreground text-xs font-medium tracking-wide">
					{title}
				</p>
			) : null}

			{multi ? (
				<p className="text-muted-foreground text-xs tabular-nums">
					{t("askUserQuestion.progress", {
						current: index + 1,
						total,
					})}
				</p>
			) : null}

			<div
				key={question.id ?? `${index}-${question.question}`}
				className="space-y-2"
			>
				<p className="text-sm leading-5">{question.question}</p>
				{question.options.length > 0 ? (
					<div className="flex flex-col gap-1.5" role="listbox">
						{question.options.map((option) => {
							const selected =
								selectedOption === option.label && !otherDraft.trim();
							return (
								<Suggestion
									key={option.label}
									suggestion={option.label}
									role="option"
									aria-selected={selected}
									aria-pressed={selected}
									disabled={busy}
									variant="outline"
									className={cn(
										"h-auto w-full justify-start gap-2.5 whitespace-normal rounded-lg border px-3 py-2.5 text-left shadow-none transition-colors",
										selected
											? "border-primary bg-primary/15 text-foreground ring-2 ring-primary/45 hover:bg-primary/20 hover:text-foreground"
											: "border-border/80 bg-background/60 hover:bg-muted/50",
									)}
									onClick={(answer) => {
										setOption(index, answer);
										// Multi-choice: advance after pick when more pages remain
										// and no free-text Other on this page (Other may still be filled).
										if (multi && !isLast && !busy && !question.allowOther) {
											setPage((p) => Math.min(total - 1, p + 1));
										}
									}}
								>
									<span
										className={cn(
											"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
											selected
												? "border-primary bg-primary text-primary-foreground"
												: "border-muted-foreground/35 bg-transparent",
										)}
										aria-hidden
									>
										{selected ? (
											<Check className="size-2.5 stroke-[3]" />
										) : null}
									</span>
									<span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
										<span
											className={cn(
												"text-sm",
												selected ? "font-semibold" : "font-medium",
											)}
										>
											{option.label}
										</span>
										{option.description ? (
											<span
												className={cn(
													"text-xs leading-snug",
													selected
														? "text-foreground/75"
														: "text-muted-foreground",
												)}
											>
												{option.description}
											</span>
										) : null}
									</span>
								</Suggestion>
							);
						})}
					</div>
				) : null}
				{showOtherInput ? (
					<div
						className={cn(
							"rounded-lg transition-[box-shadow,border-color,background-color]",
							question.options.length > 0 && otherDraft.trim()
								? "ring-2 ring-primary/45"
								: null,
						)}
					>
						<Input
							value={
								question.options.length > 0 ? otherDraft : (currentAnswer ?? "")
							}
							disabled={busy}
							placeholder={t("askUserQuestion.freeTextPlaceholder")}
							className={cn(
								question.options.length > 0 && otherDraft.trim()
									? "border-primary bg-primary/10"
									: null,
							)}
							onChange={(event) => {
								const text = event.target.value;
								if (question.options.length > 0) {
									setOtherText(index, text);
								} else {
									setAnswers((current) => {
										const next = [...current];
										next[index] = text;
										return next;
									});
								}
							}}
							onKeyDown={(event) => {
								if (event.key !== "Enter" || event.nativeEvent.isComposing)
									return;
								event.preventDefault();
								if (isLast) doSubmit();
								else goNext();
							}}
						/>
					</div>
				) : null}
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{multi ? (
					<>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={isFirst || busy}
							aria-label={t("askUserQuestion.prev")}
							onClick={goPrev}
						>
							<ChevronLeft className="size-3.5" />
							{t("askUserQuestion.prev")}
						</Button>
						{isLast ? (
							<Button
								type="button"
								size="sm"
								disabled={!allReady || busy}
								onClick={doSubmit}
							>
								{submitted
									? t("askUserQuestion.submitted")
									: t("askUserQuestion.submit")}
							</Button>
						) : (
							<Button
								type="button"
								size="sm"
								disabled={!currentReady || busy}
								aria-label={t("askUserQuestion.next")}
								onClick={goNext}
							>
								{t("askUserQuestion.next")}
								<ChevronRight className="size-3.5" />
							</Button>
						)}
					</>
				) : (
					<Button
						type="button"
						size="sm"
						disabled={!allReady || busy}
						onClick={doSubmit}
					>
						{submitted
							? t("askUserQuestion.submitted")
							: t("askUserQuestion.submit")}
					</Button>
				)}
				{onCancel && !submitted ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={onCancel}
					>
						{t("askUserQuestion.cancel")}
					</Button>
				) : null}
			</div>
		</div>
	);
}
