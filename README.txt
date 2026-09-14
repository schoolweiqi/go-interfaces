Go Interfaces — automatch + captures

1. Upload index.html to the root of https://schoolweiqi.github.io/go-interfaces/
2. OAuth settings remain:
   Client type: Public
   Grant: Authorization code
   Redirect URI: https://schoolweiqi.github.io/go-interfaces/
3. Log in via OGS.
4. Choose board size and speed, then click "Найти соперника на OGS".
5. Until the local board is fully synchronized with OGS live games, after automatch finds an opponent the page safely redirects to the official OGS game screen.

Local test board now implements group/liberty capture, suicide prevention, simple ko, capture counters, and undo with restoration of captured stones.
