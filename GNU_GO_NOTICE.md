# GNU Go third-party notice

This project includes GNU Go as an independent game engine used by the School of Go interface.

## Included components

- `gnugo.js` — Emscripten JavaScript runtime/loader.
- `gnugo.wasm` — GNU Go WebAssembly binary.
- `COPYING-GNUGO.txt` — GNU General Public License version 3.
- `third_party/gnugo-source/` — source location and revision metadata for GNU Go / wasm-gnugo.

## Upstream source

Upstream project:

https://github.com/TristanCacqueray/wasm-gnugo

Reference source revision:

`382df5a9b14b62ea451012ec7d2e81c61162e037`

GNU Go is Copyright 1999–2009 Free Software Foundation, Inc. and contributors.

GNU Go is free software distributed under the GNU General Public License, version 3 or, where stated upstream, any later version.

The generated Emscripten JavaScript runtime keeps the original Emscripten copyright and permissive-license notices.

## Separation from the School interface

The School of Go web interface and GNU Go are maintained and identified as separate software components.

The School interface communicates with GNU Go through `gnugo-worker.js` and a narrow worker/message API. GNU Go is used as an independent game engine.

This architectural statement does not remove, replace, or limit any obligations imposed by the GNU GPL on GNU Go or on modified versions of GNU Go.

## Modifications

The current browser runtime is based on the upstream wasm-gnugo build.

If this project introduces a custom GNU Go build — for example a `play_level(seed, level, sgf)` export — the corresponding modified source and build instructions must be stored under `third_party/gnugo-source/` or another source location explicitly identified here.

## No warranty

GNU Go is provided without warranty, to the extent permitted by applicable law.

See `COPYING-GNUGO.txt` for the complete GNU GPL terms.
