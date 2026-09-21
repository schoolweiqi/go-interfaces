# GNU Go integration

This project loads the browser build from:

- https://github.com/TristanCacqueray/wasm-gnugo
- GNU Go itself: https://www.gnu.org/software/gnugo/

GNU Go / wasm-gnugo is distributed under GPL-3.0-or-later. The upstream source remains available at the links above.

The current public WASM build exports `get_version`, `play`, and `score`. `play` accepts an SGF string and returns the SGF with GNU Go's generated move appended. `score` calls the upstream wrapper's default score estimator.

`gnugo-custom-main.c.patch` shows the small wrapper extension planned for an exact end-of-game `score_final` export using GNU Go's `aftermath` scoring mode. `gnugo-worker.js` automatically uses `score_final` if a custom WASM build containing it is deployed later.
