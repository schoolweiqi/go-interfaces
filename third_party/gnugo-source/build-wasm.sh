#!/usr/bin/env bash
set -euo pipefail

export CFLAGS="-g -O2 -Wno-format-security -Wno-constant-conversion"
# GNU Go 3.9.1 documentation does not build with modern Texinfo.
# Documentation is not needed for the browser engine, so disable makeinfo.
export MAKEINFO=true

mkdir -p build/native
pushd build/native
  ../../configure
  make -j2
popd

mkdir -p build/wasm
pushd build/wasm
  emconfigure ../../configure --without-readline --without-curses --disable-socket-support --disable-color

  # Upstream notes that the first wasm make can fail because pattern helpers
  # must be native executables. Build what we can, then copy native helpers.
  emmake make -j2 || true

  for helper in mkpat mkeyes uncompress_fuseki joseki mkmcpat; do
    cp ../native/patterns/${helper} patterns/
    chmod +x patterns/${helper}
  done

  emmake make -j2
popd

INPUTS="build/wasm/interface/*.o build/wasm/engine/libengine.a build/wasm/patterns/libpatterns.a build/wasm/sgf/libsgf.a build/wasm/utils/libutils.a"

emcc -s BINARYEN_ASYNC_COMPILATION=0 \
     -s ALLOW_MEMORY_GROWTH=1 \
     -s EXPORTED_RUNTIME_METHODS='["ccall"]' \
     -s EXPORTED_FUNCTIONS="['_get_version', '_get_level', '_play', '_play_level', '_score']" \
     -o gnugo.js $INPUTS

# The project worker loads gnugo.js with importScripts() and injects a Module
# object. Wrap the generated Emscripten runtime in exports.init(Module), which
# is the same integration boundary used by the existing browser runtime.
python3 - <<'PY'
from pathlib import Path
p = Path("gnugo.js")
s = p.read_text()
if "exports.init = function(Module)" not in s:
    s = "exports.init = function(Module) {\n" + s + "\n}\n"
p.write_text(s)
PY

grep -q '_play_level' gnugo.js
grep -q '_get_level' gnugo.js
test -s gnugo.wasm
