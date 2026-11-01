# Development fixtures

`demo-sheet.png` is an original, programmatically drawn 96×32 RGBA image with three static pixel characters on magenta. It is licensed under the repository's Apache-2.0 license.

This is a smoke-test fixture, not a quality reference for the future sheet extraction pipeline. The fake provider uses it for every generation, recoloring only the background when the sheet prompt specifies a different key.

For animation prompts, the fake provider draws deterministic frame strips with changing limb positions instead of reusing the sheet. These strips have the requested frame count and key color, and run through the actual extraction, palette, alignment, and atlas code. They test pipeline behavior, not real Muse visual quality.
