import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const _PAPER_IDS = [
	"1706.03762",
	"1810.04805",
	"2005.14165",
	"1412.6980",
	"1512.03385",
];

function demoMeta(opts) {
	return JSON.stringify(
		{
			id: opts.id,
			type: "arxiv",
			title: opts.title,
			authors: opts.authors,
			year: opts.year,
			abstract: opts.abstract,
			tags: opts.tags,
			arxiv_id: opts.id,
			doi: `10.48550/arXiv.${opts.id}`,
			pdf_url: `https://arxiv.org/pdf/${opts.id}`,
			html_url: `https://arxiv.org/html/${opts.id}`,
			source_url: `https://arxiv.org/abs/${opts.id}`,
			body_source: "latex",
			body_quality: "high",
			bibtex_key: opts.bibtex,
			status: "completed",
			added_at: "2026-07-01T10:00:00.000Z",
			updated_at: "2026-07-01T10:00:00.000Z",
		},
		null,
		2,
	);
}

const FILES = {
	"AGENTS.md": `# AGENTS.md

Rules for agents working in this vault.

- Prefer reading PAPERS.md first, then NOTES.md.
- Always cite local file paths.
`,
	"PAPERS.md": `# Papers index

- [[papers/1706.03762/NOTES]] — Attention Is All You Need
- [[papers/1810.04805/NOTES]] — BERT
- [[papers/2005.14165/NOTES]] — GPT-3
- [[papers/1412.6980/NOTES]] — Adam
- [[papers/1512.03385/NOTES]] — ResNet
`,
	"notes/idea.md": `# Idea

Compare attention mechanisms across transformer variants.

Related: [[papers/1706.03762/NOTES]] · [[papers/1810.04805/NOTES]] · [[notes/attention]]
`,
	"notes/attention.md": `# Attention

Core concept shared by Transformers and later LMs.

Papers:

- [[papers/1706.03762/NOTES]]
- [[papers/1810.04805/NOTES]]
- [[papers/2005.14165/NOTES]]
`,
	"papers/1706.03762/NOTES.md": `# NOTES — Attention Is All You Need

## Summary

Introduces the Transformer architecture based solely on attention.

## Method

Multi-head self-attention + positional encoding.

## Related

- Concept: [[notes/attention]]
- Idea: [[notes/idea]]
- Follow-ups: [[papers/1810.04805/NOTES]] · [[papers/2005.14165/NOTES]]
- Index: [[PAPERS]]
`,
	"papers/1810.04805/NOTES.md": `# NOTES — BERT

## Summary

Bidirectional pre-training for language understanding.

## Related

- Base architecture: [[papers/1706.03762/NOTES]]
- Concept: [[notes/attention]]
- Scaling: [[papers/2005.14165/NOTES]]
- Index: [[PAPERS]]
`,
	"papers/2005.14165/NOTES.md": `# NOTES — GPT-3

## Summary

Few-shot learners via large-scale language models.

## Related

- Transformer: [[papers/1706.03762/NOTES]]
- BERT contrast: [[papers/1810.04805/NOTES]]
- Optimizers often used: [[papers/1412.6980/NOTES]]
- Index: [[PAPERS]]
`,
	"papers/1412.6980/NOTES.md": `# NOTES — Adam

## Summary

Adaptive moment estimation optimizer, widely used for deep nets.

## Related

- Used in: [[papers/1706.03762/NOTES]] · [[papers/2005.14165/NOTES]]
- Vision backbone era: [[papers/1512.03385/NOTES]]
- Index: [[PAPERS]]
`,
	"papers/1512.03385/NOTES.md": `# NOTES — ResNet

## Summary

Deep residual learning for image recognition.

## Related

- Optimizers: [[papers/1412.6980/NOTES]]
- Index: [[PAPERS]]
`,
	"papers/1706.03762/metadata.json": demoMeta({
		id: "1706.03762",
		title: "Attention Is All You Need",
		authors: [
			"Ashish Vaswani",
			"Noam Shazeer",
			"Niki Parmar",
			"Jakob Uszkoreit",
			"Llion Jones",
			"Aidan N. Gomez",
			"Łukasz Kaiser",
			"Illia Polosukhin",
		],
		year: 2017,
		abstract:
			"We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
		tags: ["transformer", "attention", "nlp"],
		bibtex: "vaswani2017attention",
	}),
	"papers/1810.04805/metadata.json": demoMeta({
		id: "1810.04805",
		title:
			"BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
		authors: [
			"Jacob Devlin",
			"Ming-Wei Chang",
			"Kenton Lee",
			"Kristina Toutanova",
		],
		year: 2019,
		abstract:
			"We introduce BERT, designed to pre-train deep bidirectional representations from unlabeled text.",
		tags: ["bert", "pretraining", "nlp"],
		bibtex: "devlin2019bert",
	}),
	"papers/2005.14165/metadata.json": demoMeta({
		id: "2005.14165",
		title: "Language Models are Few-Shot Learners",
		authors: ["Tom B. Brown", "Benjamin Mann", "Nick Ryder", "Melanie Subbiah"],
		year: 2020,
		abstract:
			"We train GPT-3, an autoregressive language model with 175 billion parameters, and test its performance in the few-shot setting.",
		tags: ["gpt", "llm", "few-shot"],
		bibtex: "brown2020language",
	}),
	"papers/1412.6980/metadata.json": demoMeta({
		id: "1412.6980",
		title: "Adam: A Method for Stochastic Optimization",
		authors: ["Diederik P. Kingma", "Jimmy Ba"],
		year: 2015,
		abstract:
			"We introduce Adam, an algorithm for first-order gradient-based optimization of stochastic objective functions.",
		tags: ["optimization", "adam"],
		bibtex: "kingma2015adam",
	}),
	"papers/1512.03385/metadata.json": demoMeta({
		id: "1512.03385",
		title: "Deep Residual Learning for Image Recognition",
		authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
		year: 2016,
		abstract:
			"We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.",
		tags: ["resnet", "vision", "cnn"],
		bibtex: "he2016deep",
	}),
};

async function main() {
	const target = process.argv[2];
	if (!target) {
		console.error(
			"Usage: node test/scripts/create-demo-vault.mjs <path-to-vault>",
		);
		process.exit(1);
	}

	const root = path.resolve(target);
	for (const [rel, content] of Object.entries(FILES)) {
		const fullPath = path.join(root, rel);
		await mkdir(path.dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content, "utf8");
	}

	console.log(`Demo vault created at ${root}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
