# GNU Go level support

The public upstream wasm-gnugo build exports only `get_version`, `play`, and `score`, so it cannot change GNU Go level at runtime.

This project UI sends a requested level 0..10 to `gnugo-worker.js`. The worker calls `play_level()` when a custom build exporting `_play_level` is present. Otherwise it transparently falls back to upstream `play()` and reports that level 10 is being used.

GNU Go documents `--level`: level 10 is the default; lower levels are faster but less accurate. The custom wrapper calls `set_depth_values(level)` before loading/analyzing the SGF.

Build the custom WASM with exported functions:

```
['_get_version','_play','_play_level','_score','_score_final']
```

Then configure `gnugo-worker.js` to load the custom local `gnugo.js`/`gnugo.wasm` instead of the CDN build.
