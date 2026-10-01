# Custom GNU Go browser build

This project modifies the wasm-gnugo browser interface so that the selected GNU Go strength level is actually applied.

## Modification

`play-level.patch` adds:

- `play_level(int seed, int level, char *board)`
- explicit `set_level(level)` after GNU Go engine initialization
- clamping to levels 0–10

The WASM build exports:

- `_get_version`
- `_get_level`
- `_play`
- `_play_level`
- `_score`

This allows `gnugo-worker.js` to request a particular level and verify the level actually active in GNU Go.

## Reproducible build

GitHub Actions clones the pinned upstream source revision, applies `play-level.patch`, then runs `build-wasm.sh` inside the old Emscripten/Nix environment specified by upstream `default.nix`.

Generated runtime files are committed to the repository root:

- `gnugo.js`
- `gnugo.wasm`

The source modification remains available here under the same GNU GPL terms as GNU Go.
