# Det Dashboard Engineering Rules

## Frontend Priority

- Treat layout, visual consistency, and interaction consistency as acceptance criteria for every frontend change, not as optional polish.
- Before adding a control, inspect the closest existing workflow and reuse its component structure, spacing, typography, colors, icons, states, and responsive behavior.
- Keep the Data, Assets, Training, Inference, and Evaluation workspaces aligned in header height, sidebar geometry, section rhythm, control height, and light/dark theme behavior.
- Use the existing teal accent, Lucide icon system, compact 32px controls, restrained 6px section radii, and evaluation/inference typography unless the established local component specifies otherwise.
- Never use raw browser multi-select boxes when the data is hierarchical. Use a visible tree with expand/collapse, selection state, counts, truncation, and keyboard-accessible controls.
- Light and dark themes must share the same DOM and geometry. Theme changes may change tokens only; they must not change layout or content structure.
- Verify frontend changes in a real browser at 1920x1080, 2560x1440, and 2160x1440 when the affected workspace is responsive. Include 1365x768 when horizontal density is relevant.
- Validate both themes and check for clipping, overlap, illegible contrast, unexpected wrapping, and scrollbar color before considering the change complete.

