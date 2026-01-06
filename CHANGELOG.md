# Changelog

## v0.1.10

- Interaction: drag node by title bar only (overlay won’t drag nodes).
- UI: node params overlay is selectable on-canvas (fix positioning + selection).

## v0.1.8

- UI: show node params as selectable text on the canvas (overlay).

## v0.1.7

- UI: show node params as selectable text in sidebar.
- UI: copy sidebar JSON / node params to clipboard.
- Rendering: ComfyUI-style type colors; HiDPI canvas keeps text crisp.

## v0.1.6

- UI: copy sidebar JSON / node params to clipboard.
- Rendering: ComfyUI-style type colors; HiDPI canvas keeps text crisp.

## v0.1.5

- Interaction: faster zoom, groups only draggable via top handle.
- Rendering: slightly clearer defaults (no shadows, thicker links, monospace sidebar).

## v0.1.4

- Tabs: open multiple workflows, switch/close with menu + shortcuts.
- Interaction: fix zoom center/pan scaling, click empty space clears node/group selection.

## v0.1.3

- Release pipeline: stop uploading inner `.exe` (needs bundled `ffmpeg.dll`), publish only installer/portable exe + full zip.

## v0.1.2

- Release pipeline: always publish Windows zip artifact (packager-based).

## v0.1.1

- Show node parameters in-node (fallback overlay).
- Fix canvas panning even when a node is selected (Space+LMB or MMB).

## v0.1.0

- Initial MVP: open ComfyUI workflow `.json` / `.png` and render with LiteGraph.
