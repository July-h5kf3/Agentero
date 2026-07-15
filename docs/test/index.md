# 测试

当代码依赖 Vault 路径、Markdown 双链或论文元数据时，测试应优先创建真实的临时 Vault 目录和文件。保持 `src/` 与 `test/` 解耦：应用代码不能 import 测试 fixture 或 helper。

## 目录结构

```text
test/
├── helpers/
│   └── create-test-vault.ts
├── scripts/
│   └── create-demo-vault.mjs   # 本地 demo / 手工验收用 Vault
└── *.test.ts
```

- `test/helpers/create-test-vault.ts` 用临时目录创建真实文件形态的 Vault。
- `test/scripts/create-demo-vault.mjs` 生成符合 catalog + 嵌套 paper 文件夹约定的 demo Vault（含 `.motif/catalog.sqlite`）。
- 测试文件可以从 `src/` import 生产代码，但生产代码不能从 `test/` import。
- 优先在每个测试内声明最小必要 Vault 文件，让测试数据和断言靠近。

### Demo Vault 脚本

```bash
# 默认写到仓库 tmp/motif-demo-vault
pnpm demo:vault

# ~/Downloads/motif-demo-vault（嵌套 papers + catalog 样本数据）
pnpm demo:vault:downloads

# 仅 Create Vault 骨架（无样例论文）
pnpm demo:vault:empty -- ~/Downloads/motif-empty-vault

# 校验已有目录
pnpm demo:vault:verify -- ~/Downloads/motif-demo-vault
```

## 前端测试

运行 TypeScript 单元测试：

```bash
pnpm test
```

Vitest 适合覆盖纯 TypeScript 逻辑，例如：

- 双链解析与预览链接重写；
- Vault-relative 路径规范化与目标解析；
- settings、shortcuts、metadata、viewer 等 helper。

测试 Vault 语义时，创建临时 Vault 目录，不要在 `src/` 中引入全局 mock 数据：

```ts
const vault = await createTestVault({
	"notes/Source.md": "See [[notes/Target]].",
	"notes/Target.md": "# Target",
});

try {
	const files = await vault.listMarkdownFiles();
	// assertions
} finally {
	await vault.cleanup();
}
```

## Rust 测试

运行后端测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

解析器和 resolver 的边界用例可以放在对应 Rust 模块的 `#[cfg(test)]` 中。依赖 Vault 的 graph/index 测试应创建临时目录和文件，不依赖已提交的缓存文件。

## 手动验证

纯逻辑优先用自动化测试覆盖。涉及 UI 或桌面流程时，还需要启动应用检查受影响路径。如果 dev 端口被占用或无法做浏览器/桌面验证，汇报时需要明确说明。

## 文档验证

修改 docs 或 `mkdocs.yml` 后运行：

```bash
mkdocs build --strict
```

如果本地未安装 MkDocs，先创建文档环境：

```bash
python3 -m venv .venv-docs
. .venv-docs/bin/activate
pip install mkdocs==1.6.1
mkdocs build --strict
```
