# ComfyUI Workflow Viewer

独立的桌面应用，用于离线查看 ComfyUI 工作流（`.json` / 带 metadata 的 `.png`），无需启动 ComfyUI 后端。

## 开发

```bash
npm install
npm run dev
```

## 打包

```bash
npm run dist
```

如果本机 `npm run dist` 因 Windows 符号链接权限失败，可以用“免安装目录版”：

```bash
npm run pack:win
```

输出目录：`release/ComfyUI Workflow Viewer-win32-x64/`（里面有 `ComfyUI Workflow Viewer.exe`）。

Windows 上若遇到 “Cannot create symbolic link / 客户端没有所需的特权”，请开启系统“开发者模式”(Developer Mode) 或使用管理员权限运行后重试。
