# JSON Handle (Tauri macOS App)

![JSON Handle Icon](public/app-icon.png)

下载地址（GitHub Release）：  
[https://github.com/gexiaowei/json-handle-mac/releases/latest](https://github.com/gexiaowei/json-handle-mac/releases/latest)

一个面向 macOS 的 JSON 处理工具，提供结构化 Tree View、节点编辑、类型生成与高亮预览。前端使用 Vite + React，桌面端基于 Tauri。

## 功能

- JSON 解析与校验（状态栏提示）
- Tree View 展示层级结构，支持节点选择与高亮
- 右键菜单：复制路径、复制值、生成类型
- 节点编辑：支持 JSON 与字符串两种写入方式
- 生成 TypeScript / Java / Kotlin 类型（带代码高亮）
- Tauri 菜单：Open / Save / Format / Minify / Validate / Expand / Collapse / Settings

## 目录结构

```
.
├── src/                      # 前端源码
│   ├── components/
│   │   └── ui/                # shadcn 风格组件与 tree view
│   ├── lib/
│   │   └── utils.ts           # shadcn 工具函数
│   ├── App.tsx                # 主界面与核心逻辑
│   ├── index.css              # Tailwind 与主题变量
│   └── main.tsx               # React 入口
├── src-tauri/                 # Tauri Rust 端
│   ├── src/
│   └── tauri.conf.json
├── public/                    # 静态资源
├── dist/                      # 前端构建产物
├── components.json            # shadcn 配置
├── tailwind.config.cjs        # Tailwind 配置
└── vite.config.ts             # Vite 配置
```

## 开发与构建

### 安装依赖

```bash
pnpm install
```

### 前端开发

```bash
pnpm dev
```

### 构建前端

```bash
pnpm build
```

### 构建 macOS App（Tauri）

```bash
pnpm run tauri:build
```

构建产物默认在 `src-tauri/target/release/bundle/macos/`。

## 说明

- Tree View 基于 `mrlightful/shadcn-tree-view` 思路改造
- 主题色使用 shadcn 默认主色调
